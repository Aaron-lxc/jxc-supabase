/* ============================================================================
   数据存储层 + 核心业务逻辑（Supabase 云端版）

   与单机版的差异仅三处，业务算法完全一致：
   1. 持久化：本地 JSON 文件 → Supabase records 表（经 Sync 引擎行级同步）
   2. 主键：meta.id 自增 → 时间戳+随机的全局唯一 id（多人同时录入不会撞号）
   3. 单号/编码：本地计数器 → 扫描现有数据取最大号 +1（配合实时同步，抗并发）
   ========================================================================== */
window.S = {
  state: Vue.reactive({ db: null, ready: false }),
  get db() { return this.state.db; },

  emptyDB() {
    return {
      meta: { id: 1, seq: {} },
      goodsTypes: [], units: [], suppliers: [], goods: [],
      custLevels: [], custTypes: [], regions: [], customers: [],
      resourcePartners: [], regionPartners: [],
      warehouses: [],
      purchases: [],
      stocks: [], stockChecks: [],
      sales: [], returns: [],
      expenseCats: [], expenses: [],
      complaintTypes: [], complaints: [],
      resourceRates: [], regionRates: [],
      commissionPayments: [],
      settings: {
        company: '我的公司', fixedCosts: [], backupKeep: 20, backupDays: 0,
        saleTemplate: null /* 为空时使用系统默认模版，见 sales.js DEFAULT_TPL */
      }
    };
  },

  /* ---------------- 启动 ----------------
     opts.demo = true 时，若账套为空则灌入演示数据 */
  async init(opts) {
    const { db, empty } = await Sync.loadAll();
    const base = this.emptyDB();

    let data = db;
    if (empty) {
      data = (opts && opts.demo && window.Demo) ? Demo.build() : base;
      if (opts && opts.company) data.settings.company = opts.company;
    }
    for (const k of Object.keys(base)) if (data[k] === undefined) data[k] = base[k];
    this.migrateTaxManual(data);

    this.state.db = data;
    this.state.ready = true;
    this._buildIds();

    if (empty) {
      await Sync.pushAll();          // 新账套：把初始数据整体写入云端
    } else {
      Sync.resetShadow(this.state.db);
    }
    Sync.start();
  },

  /* 退出账套时清理 */
  teardown() {
    Sync.stop();
    this.state.db = null;
    this.state.ready = false;
    this._ids = null;
  },

  /* ---------------- 持久化（转交同步引擎） ---------------- */
  persist() { Sync.schedule(); },
  persistNow() { return Sync.push(); },

  /* 远端数据覆盖本地（保持 Vue 响应式引用） */
  applyRemoteDB(db) {
    const base = this.emptyDB();
    for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
    this.migrateTaxManual(db);
    if (!this.state.db) { this.state.db = db; }
    else {
      for (const k of Object.keys(db)) this.state.db[k] = db[k];
      for (const k of Object.keys(this.state.db)) if (db[k] === undefined) delete this.state.db[k];
    }
    this._buildIds();
  },

  /* 导入备份：整库替换（先清空云端再全量写入） */
  async replace(db) {
    const base = this.emptyDB();
    for (const k of Object.keys(base)) if (db[k] === undefined) db[k] = base[k];
    this.migrateTaxManual(db);
    for (const k of Object.keys(db)) this.state.db[k] = db[k];
    for (const k of Object.keys(this.state.db)) if (db[k] === undefined) delete this.state.db[k];
    this._buildIds();
    await Sync.wipeRemote();
    await Sync.pushAll();
  },

  /* 一次性迁移：为历史销售单回填 taxManual（税点是否手工特调）标记。
     仅处理未完成单（已完成单不参与客户税点同步，无需标记）。
     判定：单据税点与客户当前税点不一致 => 视为手工特调 true，否则 false。
     未快照过税点的老单按客户值回退，判定为 false（跟随同步）。 */
  migrateTaxManual(db) {
    (db.sales || []).forEach(s => {
      if (s.taxManual !== undefined) return;
      if (s.status === '已完成') return;
      const c = (db.customers || []).find(x => x.id === s.customerId);
      const cRate = c ? Number(c.taxRate || 0) : 0;
      const cExempt = c ? (c.taxExempt || '否') : '否';
      const sRate = (s.taxRate == null || s.taxRate === '') ? cRate : Number(s.taxRate);
      const sExempt = (s.taxExempt == null || s.taxExempt === '') ? cExempt : s.taxExempt;
      s.taxManual = (sRate !== cRate || sExempt !== cExempt);
    });
  },

  /* ---------------- id / 编号（去中心化，抗并发） ---------------- */
  _ids: null,

  _buildIds() {
    const set = new Set();
    Sync.COLLS.forEach(c => (this.db[c] || []).forEach(r => {
      if (r && r.id != null) set.add(Number(r.id));
    }));
    this._ids = set;
  },

  noteId(id) { if (this._ids && id != null) this._ids.add(Number(id)); },

  /* 毫秒时间戳 ×1000 + 随机位：全局唯一且仍是数字（安全整数范围内） */
  genId() {
    if (!this._ids) this._buildIds();
    for (let i = 0; i < 200; i++) {
      const id = Date.now() * 1000 + Math.floor(Math.random() * 1000);
      if (!this._ids.has(id)) { this._ids.add(id); return id; }
    }
    const fb = Date.now() * 1000 + Math.floor(Math.random() * 1000);
    this._ids.add(fb);
    return fb;
  },

  /* 扫描现有单据取当天最大号 +1；配合实时同步，多人开单不会重号 */
  genNo(prefix) { /* PO-20260730-00001 */
    const d = new Date();
    const ymd = `${d.getFullYear()}${U.pad(d.getMonth() + 1)}${U.pad(d.getDate())}`;
    const head = `${prefix}-${ymd}-`;
    let max = 0;
    Sync.COLLS.forEach(c => (this.db[c] || []).forEach(r => {
      if (r && typeof r.no === 'string' && r.no.indexOf(head) === 0) {
        const n = parseInt(r.no.slice(head.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }));
    const key = prefix + ymd;
    const next = Math.max(max, Number(this.db.meta.seq[key] || 0)) + 1;
    this.db.meta.seq[key] = next;
    return `${prefix}-${ymd}-${U.pad(next, 5)}`;
  },

  genCode(prefix) { /* GD-0001 / CU-0001 */
    const head = prefix + '-';
    let max = 0;
    Sync.COLLS.forEach(c => (this.db[c] || []).forEach(r => {
      if (r && typeof r.code === 'string' && r.code.indexOf(head) === 0) {
        const n = parseInt(r.code.slice(head.length), 10);
        if (!isNaN(n) && n > max) max = n;
      }
    }));
    const next = Math.max(max, Number(this.db.meta.seq[prefix] || 0)) + 1;
    this.db.meta.seq[prefix] = next;
    return `${prefix}-${U.pad(next, 4)}`;
  },

  /* ------- 通用查询 ------- */
  byId(coll, id) { return (this.db[coll] || []).find(x => x.id === id) || null; },
  name(coll, id, key) {
    const r = this.byId(coll, id);
    return r ? (r[key || 'name'] || '') : '';
  },
  enabled(coll) { return (this.db[coll] || []).filter(x => x.status === '已启用'); },

  /* ------- 引用检查（被引用则禁止删除） ------- */
  usedBy(coll, id) {
    const db = this.db;
    const refs = {
      goodsTypes: () => db.goods.some(g => g.typeId === id),
      units: () => db.goods.some(g => g.unitId === id),
      suppliers: () => db.goods.some(g => g.supplierId === id),
      custLevels: () => db.customers.some(c => c.levelId === id),
      custTypes: () => db.customers.some(c => c.typeId === id),
      regions: () => db.customers.some(c => c.regionId === id) || db.regionPartners.some(p => p.regionId === id),
      resourcePartners: () => db.customers.some(c => c.r1 === id || c.r2 === id || c.r3 === id),
      regionPartners: () => db.customers.some(c => c.regionPartnerId === id) || db.regionRates.some(r => r.partnerId === id),
      warehouses: () => db.purchases.some(p => p.whId === id) || db.sales.some(s => s.whId === id) || db.stocks.some(s => s.whId === id && s.qty > 0),
      goods: () => db.purchases.some(p => p.goodsId === id) || db.sales.some(s => (s.items || []).some(i => i.goodsId === id)) || db.stocks.some(s => s.goodsId === id && s.qty > 0),
      customers: () => db.sales.some(s => s.customerId === id) || db.complaints.some(c => c.customerId === id),
      expenseCats: () => db.expenses.some(x => x.catId === id),
      complaintTypes: () => db.complaints.some(x => x.typeId === id)
    };
    return refs[coll] ? refs[coll]() : false;
  },

  /* ------- 库存 ------- */
  stockRec(whId, goodsId, create) {
    let rec = this.db.stocks.find(s => s.whId === whId && s.goodsId === goodsId);
    if (!rec && create) {
      rec = { id: this.genId(), whId, goodsId, qty: 0, lastInTime: '', lastCheckTime: '' };
      this.db.stocks.push(rec);
    }
    return rec || null;
  },
  stockQty(whId, goodsId) {
    const r = this.db.stocks.find(s => s.whId === whId && s.goodsId === goodsId);
    return r ? r.qty : 0;
  },
  goodsTotalQty(goodsId) {
    return this.db.stocks.filter(s => s.goodsId === goodsId).reduce((a, b) => a + b.qty, 0);
  },

  /* ------- 采购 ------- */
  addPurchase(p) {
    p.id = this.genId();
    p.no = this.genNo('PO');
    p.inTime = U.now();
    p.amount = U.round2(p.qty * p.price);
    p.operator = Cloud.state.user ? Cloud.state.user.name : '';
    this.db.purchases.push(p);
    const rec = this.stockRec(p.whId, p.goodsId, true);
    rec.qty += Number(p.qty);
    rec.lastInTime = p.inTime;
    return p;
  },
  deletePurchase(id) {
    const p = this.byId('purchases', id);
    if (!p) return '单据不存在';
    const rec = this.stockRec(p.whId, p.goodsId, false);
    if (!rec || rec.qty < p.qty) return '库存不足以回滚（该批货可能已售出），无法删除';
    rec.qty -= Number(p.qty);
    this.db.purchases = this.db.purchases.filter(x => x.id !== id);
    return null;
  },

  /* ------- 销售 ------- */
  saleReturnedAmt(saleId) {
    return U.round2(this.db.returns.filter(r => r.saleId === saleId)
      .reduce((a, r) => a + (r.total || 0), 0));
  },
  saleReturnedQty(saleId, itemIdx) {
    let q = 0;
    this.db.returns.filter(r => r.saleId === saleId).forEach(r => {
      (r.items || []).forEach(it => { if (it.itemIdx === itemIdx) q += Number(it.qty); });
    });
    return q;
  },
  saleNet(sale) { return U.round2((sale.total || 0) - this.saleReturnedAmt(sale.id)); },
  /* 含税应付 = 净额 + 税点费用（用于客户应付/累计欠款口径；佣金基数仍用 saleNet，与本函数无关） */
  salePayable(sale) { return U.round2(this.saleNet(sale) + this.saleTaxCost(sale)); },
  saleQty(sale) { return (sale.items || []).reduce((a, i) => a + Number(i.qty), 0); },
  saleNetQty(sale) {
    let q = this.saleQty(sale);
    this.db.returns.filter(r => r.saleId === sale.id).forEach(r => {
      (r.items || []).forEach(it => { q -= Number(it.qty); });
    });
    return q;
  },
  saleCost(sale) { /* 按商品采购价计算销售成本（净额口径：扣除退货数量） */
    let cost = 0;
    (sale.items || []).forEach((it, idx) => {
      const g = this.byId('goods', it.goodsId);
      const netQty = Number(it.qty) - this.saleReturnedQty(sale.id, idx);
      cost += (g ? Number(g.purchasePrice) : 0) * netQty;
    });
    return U.round2(cost);
  },

  finishSale(sale) { /* 完成：校验并扣减库存 */
    for (const it of sale.items) {
      const q = this.stockQty(sale.whId, it.goodsId);
      const need = sale.items.filter(x => x.goodsId === it.goodsId).reduce((a, b) => a + Number(b.qty), 0);
      if (q < need) return `「${this.name('goods', it.goodsId)}」库存不足（现有 ${q}）`;
    }
    sale.items.forEach(it => {
      const rec = this.stockRec(sale.whId, it.goodsId, true);
      rec.qty -= Number(it.qty);
    });
    /* 完成瞬间固化税点快照：此后该单不再受客户档案税点变更影响 */
    if (sale.taxRate == null || sale.taxRate === '') {
      const c = this.byId('customers', sale.customerId);
      sale.taxRate = c ? Number(c.taxRate || 0) : 0;
      sale.taxExempt = c ? (c.taxExempt || '否') : '否';
    }
    sale.status = '已完成';
    sale.finishTime = U.now();
    sale.payStatus = sale.payStatus || '未支付';
    sale.finishBy = Cloud.state.user ? Cloud.state.user.name : '';
    return null;
  },

  addReturn(sale, items) { /* items: [{itemIdx, qty}] */
    const lines = [];
    let total = 0;
    for (const r of items) {
      if (!r.qty || r.qty <= 0) continue;
      const it = sale.items[r.itemIdx];
      const already = this.saleReturnedQty(sale.id, r.itemIdx);
      if (r.qty > Number(it.qty) - already) return `「${this.name('goods', it.goodsId)}」退货数量超过可退数量`;
      const amt = U.round2(r.qty * it.price);
      lines.push({ itemIdx: r.itemIdx, goodsId: it.goodsId, qty: Number(r.qty), price: it.price, amount: amt });
      total += amt;
    }
    if (!lines.length) return '请填写退货数量';
    const rt = {
      id: this.genId(), no: this.genNo('RT'), saleId: sale.id, saleNo: sale.no,
      customerId: sale.customerId, whId: sale.whId, items: lines,
      total: U.round2(total), createTime: U.now(),
      operator: Cloud.state.user ? Cloud.state.user.name : ''
    };
    this.db.returns.push(rt);
    lines.forEach(l => { const rec = this.stockRec(sale.whId, l.goodsId, true); rec.qty += l.qty; });
    return null;
  },

  /* ------- 结算 / 账期 ------- */
  saleDueDate(sale) {
    const c = this.byId('customers', sale.customerId);
    const fin = U.ymd(sale.finishTime || sale.createTime);
    if (!c || c.payCycle === '现结' || !c.payCycle) return fin;
    const day = Math.min(Math.max(Number(c.payDay) || 31, 1), 31);
    let y = Number(fin.slice(0, 4)), m = Number(fin.slice(5, 7));
    if (c.payCycle === '次月结') { m += 1; if (m > 12) { m = 1; y += 1; } }
    const dd = Math.min(day, U.daysInMonth(y, m));
    const due = `${y}-${U.pad(m)}-${U.pad(dd)}`;
    return (c.payCycle === '当月结' && due < fin) ? fin : due;
  },
  saleOverdueDays(sale) {
    if (sale.status !== '已完成' || sale.payStatus === '已支付') return 0;
    const d = U.daysBetween(this.saleDueDate(sale), U.today());
    return d > 0 ? d : 0;
  },
  custArrears(custId) { /* 客户累计未支付（含税应付口径：净额 + 税点费用） */
    return U.round2(this.db.sales
      .filter(s => s.customerId === custId && s.status === '已完成' && s.payStatus !== '已支付')
      .reduce((a, s) => a + this.salePayable(s), 0));
  },
  custOverdueArrears(custId) {
    return U.round2(this.db.sales
      .filter(s => s.customerId === custId && s.status === '已完成' && s.payStatus !== '已支付' && this.saleOverdueDays(s) > 0)
      .reduce((a, s) => a + this.salePayable(s), 0));
  },

  /* ------- 佣金 ------- */
  activeResourceRate(level) {
    const r = this.db.resourceRates.find(x => x.level === level && x.status === '已启用');
    return r ? Number(r.rate) : 0;
  },
  activeRegionRate(partnerId) {
    const r = this.db.regionRates.find(x => x.partnerId === partnerId && x.status === '已启用');
    return r ? Number(r.rate) : 0;
  },

  completedSalesIn(d1, d2) {
    return this.db.sales.filter(s => s.status === '已完成' && U.inRange(s.finishTime || s.createTime, d1, d2));
  },

  /* 资源合伙人佣金明细：[{partnerId, level, sales, rate, commission, custCount}] */
  resourceCommission(d1, d2) {
    const map = {};
    this.completedSalesIn(d1, d2).forEach(s => {
      const c = this.byId('customers', s.customerId);
      if (!c) return;
      const net = this.saleNet(s);
      [1, 2, 3].forEach(L => {
        const pid = c['r' + L];
        if (!pid) return;
        const key = pid + '-' + L;
        if (!map[key]) map[key] = { partnerId: pid, level: L, sales: 0, custIds: new Set() };
        map[key].sales += net;
        map[key].custIds.add(c.id);
      });
    });
    return Object.values(map).map(x => {
      const rate = this.activeResourceRate(x.level);
      return {
        partnerId: x.partnerId, level: x.level, custCount: x.custIds.size,
        sales: U.round2(x.sales), rate,
        commission: U.round2(x.sales * rate / 100)
      };
    }).sort((a, b) => a.partnerId - b.partnerId || a.level - b.level);
  },

  /* 区域合伙人佣金：[{partnerId, sales, rate, commission, custCount}] */
  regionCommission(d1, d2) {
    const map = {};
    this.completedSalesIn(d1, d2).forEach(s => {
      const c = this.byId('customers', s.customerId);
      if (!c || !c.regionPartnerId) return;
      const pid = c.regionPartnerId;
      if (!map[pid]) map[pid] = { partnerId: pid, sales: 0, custIds: new Set() };
      map[pid].sales += this.saleNet(s);
      map[pid].custIds.add(c.id);
    });
    return Object.values(map).map(x => {
      const rate = this.activeRegionRate(x.partnerId);
      return {
        partnerId: x.partnerId, custCount: x.custIds.size,
        sales: U.round2(x.sales), rate,
        commission: U.round2(x.sales * rate / 100)
      };
    }).sort((a, b) => b.commission - a.commission);
  },

  totalResourceCommission(d1, d2) {
    return U.round2(this.resourceCommission(d1, d2).reduce((a, x) => a + x.commission, 0));
  },
  totalRegionCommission(d1, d2) {
    return U.round2(this.regionCommission(d1, d2).reduce((a, x) => a + x.commission, 0));
  },

  /* 税点成本。按销售单快照税点，缺失时回退客户当前值 */
  saleTaxCost(sale) {
    const c = this.byId('customers', sale.customerId);
    const rate = (sale.taxRate != null && sale.taxRate !== '') ? Number(sale.taxRate)
      : (c ? Number(c.taxRate || 0) : 0);
    const exempt = (sale.taxExempt != null && sale.taxExempt !== '') ? sale.taxExempt
      : (c ? (c.taxExempt || '否') : '否');
    if (!rate || exempt === '是') return 0;
    return U.round2(this.saleNet(sale) * rate / 100);
  },
  totalTaxCost(d1, d2) {
    return U.round2(this.completedSalesIn(d1 || null, d2 || null)
      .reduce((a, s) => a + this.saleTaxCost(s), 0));
  },

  /* ------- 佣金质押（绑定）：防退货 / 跑单导致佣金超额支付 -------
     规则：对某合伙人，其名下每个客户的「最后一次已完成销售单」，
     以及所有「未支付货款的已完成销售单」，对应佣金全部暂扣（质押），
     待该单支付完成且不再是最后一单后自动释放。 */

  /* 某张销售单归属某合伙人的佣金金额 */
  saleCommissionFor(sale, partnerId, type) {
    const c = this.byId('customers', sale.customerId);
    if (!c || sale.status !== '已完成') return 0;
    const net = this.saleNet(sale);
    if (type === '区域') {
      if (c.regionPartnerId !== partnerId) return 0;
      return U.round2(net * this.activeRegionRate(partnerId) / 100);
    }
    let sum = 0;
    [1, 2, 3].forEach(L => {
      if (c['r' + L] === partnerId) sum += net * this.activeResourceRate(L) / 100;
    });
    return U.round2(sum);
  },

  /* 合伙人名下客户 id 列表 */
  partnerCustomerIds(partnerId, type) {
    return this.db.customers.filter(c => type === '区域'
      ? c.regionPartnerId === partnerId
      : (c.r1 === partnerId || c.r2 === partnerId || c.r3 === partnerId)
    ).map(c => c.id);
  },

  /* 质押明细：[{saleId, no, custName, net, commission, reasons:[], payStatus, finishTime}] */
  pledgeList(partnerId, type) {
    const custIds = this.partnerCustomerIds(partnerId, type);
    if (!custIds.length) return [];
    const done = this.db.sales.filter(s => s.status === '已完成' && custIds.includes(s.customerId));
    const lastByCust = {};
    done.forEach(s => {
      const k = s.customerId, t = s.finishTime || s.createTime;
      if (!lastByCust[k] || t > (lastByCust[k].finishTime || lastByCust[k].createTime)) lastByCust[k] = s;
    });
    const lastIds = Object.values(lastByCust).map(s => s.id);
    const out = [];
    done.forEach(s => {
      const reasons = [];
      if (lastIds.includes(s.id)) reasons.push('客户最后一单');
      if (s.payStatus !== '已支付') reasons.push('货款未支付');
      if (!reasons.length) return;
      const comm = this.saleCommissionFor(s, partnerId, type);
      if (comm <= 0) return;
      out.push({
        saleId: s.id, no: s.no, custName: this.name('customers', s.customerId),
        net: this.saleNet(s), commission: comm, reasons,
        payStatus: s.payStatus || '未支付', finishTime: s.finishTime || s.createTime
      });
    });
    return out.sort((a, b) => (b.finishTime || '').localeCompare(a.finishTime || ''));
  },
  pledgeAmount(partnerId, type) {
    return U.round2(this.pledgeList(partnerId, type).reduce((a, x) => a + x.commission, 0));
  },

  /* 合伙人佣金总账：应得 / 已付 / 质押 / 可支付 */
  partnerCommissionAccount(partnerId, type) {
    const earned = type === '区域'
      ? (() => { const r = this.regionCommission(null, null).find(x => x.partnerId === partnerId); return r ? r.commission : 0; })()
      : U.round2(this.resourceCommission(null, null).filter(x => x.partnerId === partnerId).reduce((a, x) => a + x.commission, 0));
    const paid = this.commissionPaid(partnerId, type);
    const pledge = this.pledgeAmount(partnerId, type);
    const payable = U.round2(Math.max(0, earned - paid - pledge));
    return { earned: U.round2(earned), paid, pledge, payable, unpaid: U.round2(earned - paid) };
  },

  /* 佣金支付（记录清单 + 累计已付/待付） */
  commissionPaid(partnerId, type) {
    return U.round2((this.db.commissionPayments || [])
      .filter(p => p.partnerId === partnerId && p.type === type)
      .reduce((a, p) => a + Number(p.amount), 0));
  },
  commissionPayList(partnerId, type) {
    return (this.db.commissionPayments || [])
      .filter(p => p.partnerId === partnerId && p.type === type)
      .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  },
  addCommissionPay(p) {
    const rec = {
      id: this.genId(), partnerId: p.partnerId, type: p.type, amount: Number(p.amount),
      time: U.now(), remark: p.remark || '',
      operator: Cloud.state.user ? Cloud.state.user.name : ''
    };
    this.db.commissionPayments.push(rec);
    return rec;
  },

  /* 资源合伙人各级人数（按客户引用去重） */
  resourcePartnerLevelCounts() {
    const sets = { 1: new Set(), 2: new Set(), 3: new Set() }, all = new Set();
    this.db.customers.filter(c => c.status === '已启用').forEach(c => {
      [1, 2, 3].forEach(L => { if (c['r' + L]) { sets[L].add(c['r' + L]); all.add(c['r' + L]); } });
    });
    return { l1: sets[1].size, l2: sets[2].size, l3: sets[3].size, total: all.size };
  }
};
