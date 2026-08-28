/* ============================================================================
 * compute-core.js — 进销存报表计算核心（纯函数，Node 与浏览器共用）
 *
 * 目的：把 js/store.js 里的佣金 / 欠款 / 库存 / 经营算法，复刻成不依赖 Vue /
 * window 的纯函数，供「企微定时推送脚本」与「只读明细页」共用，保证口径一致。
 *
 * 用法（Node）：  const { buildDB, makeCompute } = require('./compute-core');
 * 用法（浏览器）：<script src="compute-core.js"></script> → window.ComputeCore
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- 工具函数（对齐 js/utils.js） ---------------- */
  const U = {
    pad(n, w) { return String(n == null ? '' : n).padStart(w || 2, '0'); },
    round2(n) { return Math.round((Number(n) || 0) * 100) / 100; },
    ymd(s) { return (s || '').slice(0, 10); },
    today() {
      const d = new Date();
      return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    },
    now() {
      const d = new Date();
      return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())} `
        + `${this.pad(d.getHours())}:${this.pad(d.getMinutes())}:${this.pad(d.getSeconds())}`;
    },
    addDays(dateStr, days) {
      const d = dateStr ? new Date(dateStr.slice(0, 10) + 'T00:00:00') : new Date();
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())}`;
    },
    daysBetween(a, b) { /* b - a 的天数 */
      const da = new Date(this.ymd(a) + 'T00:00:00');
      const db = new Date(this.ymd(b) + 'T00:00:00');
      return Math.round((db - da) / 86400000);
    },
    daysInMonth(y, m) { return new Date(y, m, 0).getDate(); },
    inRange(dateStr, d1, d2) {
      const d = this.ymd(dateStr);
      if (!d) return false;
      if (d1 && d < d1) return false;
      if (d2 && d > d2) return false;
      return true;
    }
  };

  /* ---------------- 默认空库（对齐 store.emptyDB） ---------------- */
  function emptyDB() {
    return {
      meta: { id: 1, seq: {} },
      goodsTypes: [], units: [], suppliers: [], goods: [],
      custLevels: [], custTypes: [], regions: [], customers: [],
      resourcePartners: [], regionPartners: [],
      warehouses: [], purchases: [], stocks: [], stockChecks: [],
      sales: [], returns: [], productions: [],
      expenseCats: [], expenses: [],
      complaintTypes: [], complaints: [],
      rewardTypes: [], rewards: [], dealerRewards: [],
      regionAssessArchive: [],
      resourceRates: [], regionRates: [], commissionPayments: [],
      openingStocks: [], openingAr: [], openingAp: [], openingFunds: [], capitalInjections: [],
      settings: {
        company: '我的公司', fixedCosts: [], backupKeep: 20, backupDays: 0,
        saleTemplate: null, opened: false, openTime: '',
        feeRates: { '现金': 0, '微信': 0, '支付宝': 0, '收款码': 0, '对公': 0, '银行卡': 0, '其他': 0 }
      }
    };
  }

  /* 由 Supabase records 行构建 db 对象 */
  function buildDB(rows) {
    const db = emptyDB();
    const SINGLETONS = ['meta', 'settings'];
    (rows || []).forEach(r => {
      if (!r || !r.coll || !r.data) return;
      if (SINGLETONS.includes(r.coll)) { db[r.coll] = r.data; return; }
      if (!Array.isArray(db[r.coll])) db[r.coll] = [];
      db[r.coll].push(r.data);
    });
    for (const k of Object.keys(emptyDB())) if (db[k] === undefined) db[k] = emptyDB()[k];
    migrateTaxManual(db);
    ensureSettings(db);
    return db;
  }

  function migrateTaxManual(db) {
    (db.sales || []).forEach(s => {
      if (s.deliveryFee == null) s.deliveryFee = 0;
      if (s.taxManual !== undefined) return;
      if (s.status === '已完成') return;
      const c = (db.customers || []).find(x => x.id === s.customerId);
      const cRate = c ? Number(c.taxRate || 0) : 0;
      const cExempt = c ? (c.taxExempt || '否') : '否';
      const sRate = (s.taxRate == null || s.taxRate === '') ? cRate : Number(s.taxRate);
      const sExempt = (s.taxExempt == null || s.taxExempt === '') ? cExempt : s.taxExempt;
      s.taxManual = (sRate !== cRate || sExempt !== cExempt);
    });
  }

  function ensureSettings(db) {
    const base = emptyDB().settings;
    if (!db.settings || typeof db.settings !== 'object') { db.settings = Object.assign({}, base); return; }
    for (const k of Object.keys(base)) if (db.settings[k] === undefined) db.settings[k] = base[k];
    if (!db.settings.feeRates || typeof db.settings.feeRates !== 'object') db.settings.feeRates = Object.assign({}, base.feeRates);
    else for (const m of Object.keys(base.feeRates)) if (db.settings.feeRates[m] === undefined) db.settings.feeRates[m] = base.feeRates[m];
    if (db.settings.opened === undefined) db.settings.opened = false;
    if (db.settings.openTime === undefined) db.settings.openTime = '';
  }

  /* ---------------- 计算引擎 ---------------- */
  function makeCompute(db) {
    const S = {
      db,
      byId(coll, id) { return (db[coll] || []).find(x => x.id === id) || null; },
      name(coll, id, key) { const r = this.byId(coll, id); return r ? (r[key || 'name'] || '') : ''; },
      enabled(coll) { return (db[coll] || []).filter(x => x.status === '已启用'); },

      /* 销售 */
      saleReturnedAmt(saleId) {
        return U.round2((db.returns || []).filter(r => r.saleId === saleId).reduce((a, r) => a + (r.total || 0), 0));
      },
      saleNet(sale) { return U.round2((sale.total || 0) - this.saleReturnedAmt(sale.id)); },
      saleTaxCost(sale) {
        const c = this.byId('customers', sale.customerId);
        const rate = (sale.taxRate != null && sale.taxRate !== '') ? Number(sale.taxRate) : (c ? Number(c.taxRate || 0) : 0);
        const exempt = (sale.taxExempt != null && sale.taxExempt !== '') ? sale.taxExempt : (c ? (c.taxExempt || '否') : '否');
        if (!rate || exempt === '是') return 0;
        return U.round2(this.saleNet(sale) * rate / 100);
      },
      salePayable(sale) { return U.round2(this.saleNet(sale) + this.saleTaxCost(sale)); },
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
      completedSalesIn(d1, d2) {
        return (db.sales || []).filter(s => s.status === '已完成' && U.inRange(s.finishTime || s.createTime, d1, d2));
      },

      /* 欠款 */
      custArrears(custId) {
        return U.round2((db.sales || []).filter(s => s.customerId === custId && s.status === '已完成' && s.payStatus !== '已支付')
          .reduce((a, s) => a + this.salePayable(s), 0));
      },
      custOverdueArrears(custId) {
        return U.round2((db.sales || []).filter(s => s.customerId === custId && s.status === '已完成' && s.payStatus !== '已支付' && this.saleOverdueDays(s) > 0)
          .reduce((a, s) => a + this.salePayable(s), 0));
      },

      /* 佣金 - 费率 */
      activeResourceRate(level) {
        const r = (db.resourceRates || []).find(x => x.level === level && x.status === '已启用');
        return r ? Number(r.rate) : 0;
      },
      activeRegionRate(partnerId) {
        const r = (db.regionRates || []).find(x => x.partnerId === partnerId && x.status === '已启用');
        return r ? Number(r.rate) : 0;
      },

      /* 佣金 - 资源 */
      resourceCommission(d1, d2) {
        const map = {};
        this.completedSalesIn(d1, d2).forEach(s => {
          if ((s.incResourceCommission || '是') === '否') return;
          const c = this.byId('customers', s.customerId);
          if (!c) return;
          const net = this.saleNet(s);
          [1, 2, 3].forEach(L => {
            const pid = c['r' + L];
            if (!pid) return;
            const key = pid + '-' + L;
            if (!map[key]) map[key] = { partnerId: pid, level: L, sales: 0, custIds: new Set() };
            map[key].sales += net; map[key].custIds.add(c.id);
          });
        });
        return Object.values(map).map(x => {
          const rate = this.activeResourceRate(x.level);
          return { partnerId: x.partnerId, level: x.level, custCount: x.custIds.size, sales: U.round2(x.sales), rate, commission: U.round2(x.sales * rate / 100) };
        }).sort((a, b) => a.partnerId - b.partnerId || a.level - b.level);
      },
      /* 佣金 - 区域 */
      regionCommission(d1, d2) {
        const map = {};
        this.completedSalesIn(d1, d2).forEach(s => {
          if ((s.incRegionCommission || '是') === '否') return;
          const c = this.byId('customers', s.customerId);
          if (!c || !c.regionPartnerId) return;
          const pid = c.regionPartnerId;
          if (!map[pid]) map[pid] = { partnerId: pid, sales: 0, custIds: new Set() };
          map[pid].sales += this.saleNet(s); map[pid].custIds.add(c.id);
        });
        return Object.values(map).map(x => {
          const rate = this.activeRegionRate(x.partnerId);
          return { partnerId: x.partnerId, custCount: x.custIds.size, sales: U.round2(x.sales), rate, commission: U.round2(x.sales * rate / 100) };
        }).sort((a, b) => b.commission - a.commission);
      },
      totalResourceCommission(d1, d2) { return U.round2(this.resourceCommission(d1, d2).reduce((a, x) => a + x.commission, 0)); },
      totalRegionCommission(d1, d2) { return U.round2(this.regionCommission(d1, d2).reduce((a, x) => a + x.commission, 0)); },

      /* 佣金 - 单客户维度（区域合伙人明细用） */
      regionCommissionByCustomer(partnerId) {
        const out = [];
        (db.customers || []).filter(c => c.regionPartnerId === partnerId).forEach(c => {
          let comm = 0;
          this.completedSalesIn(null, null).forEach(s => {
            if (s.customerId !== c.id) return;
            comm += this.saleCommissionFor(s, partnerId, '区域');
          });
          if (comm > 0) out.push({ name: c.name, type: this.name('custTypes', c.typeId), commission: comm });
        });
        return out.sort((a, b) => b.commission - a.commission);
      },
      resourceCustomerLines(partnerId) {
        const out = [];
        (db.customers || []).forEach(c => {
          [1, 2, 3].forEach(L => {
            if (c['r' + L] === partnerId) out.push({ name: c.name, level: L });
          });
        });
        return out;
      },

      /* 佣金 - 单张单归属佣金 */
      saleCommissionFor(sale, partnerId, type) {
        const c = this.byId('customers', sale.customerId);
        if (!c || sale.status !== '已完成') return 0;
        if ((type === '区域' ? (sale.incRegionCommission || '是') : (sale.incResourceCommission || '是')) === '否') return 0;
        const net = this.saleNet(sale);
        if (type === '区域') {
          if (c.regionPartnerId !== partnerId) return 0;
          return U.round2(net * this.activeRegionRate(partnerId) / 100);
        }
        let sum = 0;
        [1, 2, 3].forEach(L => { if (c['r' + L] === partnerId) sum += net * this.activeResourceRate(L) / 100; });
        return U.round2(sum);
      },
      partnerCustomerIds(partnerId, type) {
        return (db.customers || []).filter(c => type === '区域'
          ? c.regionPartnerId === partnerId
          : (c.r1 === partnerId || c.r2 === partnerId || c.r3 === partnerId)).map(c => c.id);
      },
      pledgeList(partnerId, type) {
        const custIds = this.partnerCustomerIds(partnerId, type);
        if (!custIds.length) return [];
        const done = (db.sales || []).filter(s => s.status === '已完成' && custIds.includes(s.customerId));
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
      pledgeAmount(partnerId, type) { return U.round2(this.pledgeList(partnerId, type).reduce((a, x) => a + x.commission, 0)); },
      commissionPaid(partnerId, type) {
        return U.round2((db.commissionPayments || []).filter(p => p.partnerId === partnerId && p.type === type).reduce((a, p) => a + Number(p.amount), 0));
      },
      partnerCommissionAccount(partnerId, type) {
        const earned = type === '区域'
          ? (() => { const r = this.regionCommission(null, null).find(x => x.partnerId === partnerId); return r ? r.commission : 0; })()
          : U.round2(this.resourceCommission(null, null).filter(x => x.partnerId === partnerId).reduce((a, x) => a + x.commission, 0));
        const paid = this.commissionPaid(partnerId, type);
        const pledge = this.pledgeAmount(partnerId, type);
        const payable = U.round2(Math.max(0, earned - paid - pledge));
        return { earned: U.round2(earned), paid, pledge, payable, unpaid: U.round2(earned - paid) };
      },

      /* 经销商 / 年度采购奖励（与 store.js 口径一致） */
      dealerTypeIds() { return ((db.settings && db.settings.dealerReward && db.settings.dealerReward.typeIds) || []).map(Number).filter(Boolean); },
      isDealer(customerId) {
        const c = this.byId('customers', customerId);
        if (!c) return false;
        return this.dealerTypeIds().includes(Number(c.typeId));
      },
      dealerAnnualPurchase(customerId, year) {
        const yPrefix = String(year);
        return U.round2((db.sales || []).filter(s =>
          s.customerId === customerId && s.status === '已完成' &&
          (s.finishTime || s.createTime || '').slice(0, 4) === yPrefix
        ).reduce((a, s) => a + this.saleNet(s), 0));
      },
      dealerRewardTier(amount) {
        const dr = (db.settings && db.settings.dealerReward) || {};
        const tiers = (dr.tiers || []).slice().sort((a, b) => (Number(a.min) || 0) - (Number(b.min) || 0));
        if (!tiers.length) return null;
        for (const t of tiers) {
          const min = Number(t.min) || 0;
          const max = (t.max == null || t.max === '') ? Infinity : Number(t.max);
          if (amount >= min && amount < max) return t;
        }
        return tiers[tiers.length - 1];
      },
      dealerRewardReport(year) {
        const ids = this.dealerTypeIds();
        if (!ids.length) return [];
        return (db.customers || []).filter(c => ids.includes(Number(c.typeId))).map(c => {
          const amount = this.dealerAnnualPurchase(c.id, year);
          const tier = this.dealerRewardTier(amount);
          const reward = tier ? U.round2(amount * Number(tier.rate || 0) / 100) : 0;
          return {
            id: c.id, name: c.name, region: this.name('regions', c.regionId),
            annualAmount: amount, tier, rewardAmount: reward,
            prepaidBalance: this.dealerPrepaidBalance(c.id),
            settled: this.dealerSettledAmount(c.id, year)
          };
        }).sort((a, b) => b.annualAmount - a.annualAmount);
      },
      dealerPrepaidBalance(customerId) {
        let total = 0, used = 0;
        (db.dealerRewards || []).forEach(r => {
          if (r.dealerId !== customerId || r.settleType !== '预存货款') return;
          total += Number(r.rewardAmount) || 0;
          used += Number(r.usedAmount) || 0;
        });
        return U.round2(total - used);
      },
      dealerSettledAmount(customerId, year) {
        return U.round2((db.dealerRewards || []).filter(r => r.dealerId === customerId && r.year === year)
          .reduce((a, r) => a + (Number(r.rewardAmount) || 0), 0));
      },

      /* 库存 */
      goodsTotalQty(goodsId) { return (db.stocks || []).filter(s => s.goodsId === goodsId).reduce((a, b) => a + b.qty, 0); },

      /* 资产 / 注资 */
      totalCapitalInjected() { return U.round2((db.capitalInjections || []).reduce((a, x) => a + Number(x.amount), 0)); },
      totalOpeningFunds() { return U.round2((db.openingFunds || []).reduce((a, x) => a + Number(x.amount), 0)); },

      /* 成本 */
      totalTaxCost(d1, d2) { return U.round2(this.completedSalesIn(d1 || null, d2 || null).reduce((a, s) => a + this.saleTaxCost(s), 0)); },
      totalDeliveryCost(d1, d2) { return U.round2(this.completedSalesIn(d1 || null, d2 || null).reduce((a, s) => a + this.saleDeliveryCost(s), 0)); },
      saleDeliveryCost(sale) { return U.round2(Number(sale.deliveryFee || 0)); },

      /* 预警 */
      stockAlerts() {
        const byGoods = {};
        (db.stocks || []).forEach(st => { byGoods[st.goodsId] = (byGoods[st.goodsId] || 0) + st.qty; });
        return this.enabled('goods')
          .map(g => ({ id: g.id, name: g.name, qty: byGoods[g.id] || 0, min: g.minStock || 0 }))
          .filter(r => r.qty < r.min)
          .sort((a, b) => (b.min - b.qty) - (a.min - a.qty));
      },
      payAlerts() {
        return (db.customers || []).map(c => {
          const od = (db.sales || []).filter(s => s.customerId === c.id && s.status === '已完成' && s.payStatus !== '已支付' && this.saleOverdueDays(s) > 0);
          let due = '', maxDays = 0;
          od.forEach(s => {
            const d = this.saleDueDate(s);
            if (!due || d < due) due = d;
            const n = this.saleOverdueDays(s);
            if (n > maxDays) maxDays = n;
          });
          const cyc = c.payCycle || '现结';
          const period = (cyc === '现结' || !c.payDay) ? cyc : (cyc + '（' + c.payDay + '号）');
          return { id: c.id, name: c.name, remark: c.remark || '', amt: this.custOverdueArrears(c.id), total: this.custArrears(c.id), period, due, days: maxDays, cnt: od.length };
        }).filter(r => r.amt > 0).sort((a, b) => b.amt - a.amt);
      },

      /* 全局统计（对齐 dashboard stats 子集） */
      stats() {
        const en = c => (db[c] || []).filter(x => x.status === '已启用');
        const custs = en('customers');
        let invQty = 0, invCost = 0, invValue = 0;
        (db.stocks || []).forEach(st => {
          const g = this.byId('goods', st.goodsId); if (!g) return;
          invQty += st.qty; invCost += st.qty * g.purchasePrice; invValue += st.qty * g.retailPrice;
        });
        const totalSales = U.round2((db.sales || []).filter(s => s.status === '已完成').reduce((a, s) => a + this.saleNet(s), 0));
        const opCost = U.round2((db.expenses || []).filter(x => x.status === '已计算').reduce((a, x) => a + Number(x.amount), 0));
        const resComm = this.totalResourceCommission(null, null);
        const regComm = this.totalRegionCommission(null, null);
        const taxCost = this.totalTaxCost(null, null);
        const deliveryCost = this.totalDeliveryCost(null, null);
        const receiptByMethod = {};
        (db.sales || []).filter(s => s.payStatus === '已支付').forEach(s => {
          const k = s.payMethod || '未设置';
          receiptByMethod[k] = U.round2((receiptByMethod[k] || 0) + (Number(s.actualPaid) || this.salePayable(s)));
        });
        return {
          custTotal: custs.length,
          invQty, invCost: U.round2(invCost), invValue: U.round2(invValue), invProfit: U.round2(invValue - invCost),
          totalSales, totalCost: U.round2(opCost + resComm + regComm + taxCost + deliveryCost),
          opCost, resComm, regComm, taxCost, deliveryCost,
          totalReceipts: U.round2((db.sales || []).filter(s => s.payStatus === '已支付').reduce((a, s) => a + (Number(s.actualPaid) || this.salePayable(s)), 0)),
          receiptByMethod,
          totalCapital: this.totalCapitalInjected(),
          totalOpeningFunds: this.totalOpeningFunds()
        };
      }
    };
    return S;
  }

  const API = { U, emptyDB, buildDB, makeCompute, migrateTaxManual, ensureSettings };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else global.ComputeCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
