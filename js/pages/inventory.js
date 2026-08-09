/* 库存管理 + 批量盘库 + 报损管理 + 报溢管理（Tab 聚合页） */
window.Pages = window.Pages || {};

Pages['page-inventory'] = {
  data() {
    return {
      tab: 'stock',
      // 库存明细
      q: { whId: '', typeId: '', name: '', supplierId: '', lastInT1: '', lastInT2: '' },
      page: 1, pageSize: 10, showCheck: false, checkRows: [], checkQ: { whId: '', goodsId: '' },
      // 报损管理
      lossQ: { orderNo: '', typeId: '', name: '', supplierId: '', whId: '', t1: '', t2: '' },
      lossPage: 1, lossSize: 10, showLossForm: false, editingLoss: null, lossForm: {},
      // 报溢管理
      ovQ: { orderNo: '', typeId: '', name: '', supplierId: '', whId: '', t1: '', t2: '' },
      ovPage: 1, ovSize: 10, showOvForm: false, editingOv: null, ovForm: {},
      // 调拨管理
      transferQ: { name: '', fromWhId: '', toWhId: '', t1: '', t2: '' },
      transferPage: 1, transferSize: 10, showTransferForm: false, editingTransfer: null, transferForm: {},
      // 生产组装
      prodQ: { name: '', typeId: '', whId: '', t1: '', t2: '' },
      prodPage: 1, prodSize: 10, showProdForm: false, editingProd: null, prodForm: {}
    };
  },
  computed: {
    S() { return window.S; },
    canLoss() { return P.canView('loss'); },
    canLossEdit() { return P.canEdit('loss'); },
    canOv() { return P.canView('overflow'); },
    canOvEdit() { return P.canEdit('overflow'); },
    /* 调拨：复用库存管理权限 */
    canTransfer() { return P.canView('inventory'); },
    canTransferEdit() { return P.canEdit('inventory'); },
    /* 生产组装：复用库存管理权限 */
    canProd() { return P.canView('inventory'); },
    canProdEdit() { return P.canEdit('inventory'); },
    selfSupplierId() { const s = S.db.suppliers.find(x => x.name === '自营'); return s ? s.id : ''; },
    whPickOpts() { return S.db.warehouses.map(w => ({ value: w.id, label: w.name })); },
    /* 发货仓已有库存的商品（联动下拉） */
    fromWhGoodsOpts() {
      if (!this.transferForm.fromWhId) return [{ value: '', label: '请先选择发货仓库' }];
      const ids = new Set(S.db.stocks.filter(s => s.whId === this.transferForm.fromWhId && s.qty > 0).map(s => s.goodsId));
      return [{ value: '', label: '请选择商品' }].concat(S.enabled('goods').filter(g => ids.has(g.id)).map(g => ({ value: g.id, label: g.name + '（' + g.sku + '）' })));
    },

    /* ---------- 调拨 ---------- */
    transferRows() {
      return S.db.transfers.filter(t =>
        U.kw(S.name('goods', t.goodsId), this.transferQ.name) &&
        (!this.transferQ.fromWhId || t.fromWhId === this.transferQ.fromWhId) &&
        (!this.transferQ.toWhId || t.toWhId === this.transferQ.toWhId) &&
        U.inRange(t.time, this.transferQ.t1, this.transferQ.t2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    transferPaged() { return this.transferRows.slice((this.transferPage - 1) * this.transferSize, this.transferPage * this.transferSize); },
    transferAmountSum() { return U.round2(this.transferRows.reduce((a, t) => a + Number(t.amount || 0), 0)); },
    transferLogisticsSum() { return U.round2(this.transferRows.reduce((a, t) => a + Number(t.logisticsFee || 0), 0)); },
    /* ---------- 生产组装 ---------- */
    prodRows() {
      return S.db.productions.filter(p =>
        U.kw(p.goodsName || '', this.prodQ.name) &&
        (!this.prodQ.typeId || p.typeId === this.prodQ.typeId) &&
        (!this.prodQ.whId || p.whId === this.prodQ.whId) &&
        U.inRange(p.time, this.prodQ.t1, this.prodQ.t2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    prodPaged() { return this.prodRows.slice((this.prodPage - 1) * this.prodSize, this.prodPage * this.prodSize); },
    prodQtySum() { return U.round2(this.prodRows.reduce((a, p) => a + Number(p.qty || 0), 0)); },
    prodAmountSum() { return U.round2(this.prodRows.reduce((a, p) => a + Number(p.amount || 0), 0)); },
    prodFormItemCost() { return U.round2((this.prodForm.items || []).reduce((a, it) => a + Number(it.amount || 0), 0)); },
    prodFormCostPrice() { const q = Number(this.prodForm.qty) || 0; return q > 0 ? U.round2((this.prodFormItemCost + (Number(this.prodForm.laborFee) || 0)) / q) : 0; },
    prodFormAmount() { return U.round2(this.prodFormCostPrice * (Number(this.prodForm.qty) || 0)); },
    /* 发货仓该商品可选批次（仅显示有库存的批次） */
    fromWhBatchOpts() {
      if (!this.transferForm.fromWhId || !this.transferForm.goodsId) return [{ value: '', label: '请选择批次' }];
      const rec = S.stockRec(this.transferForm.fromWhId, this.transferForm.goodsId, false);
      if (!rec || !rec.lots || !rec.lots.length) return [{ value: '', label: '无批次库存' }];
      return [{ value: '', label: '请选择批次' }].concat(rec.lots.filter(l => l.qty > 0)
        .sort((a, b) => (a.productionDate || '').localeCompare(b.productionDate || ''))
        .map(l => ({ value: l.batchNo == null ? '__NONE__' : l.batchNo, label: (l.batchNo || '未分批次') + ' / 产 ' + (l.productionDate || '-') + ' / 余 ' + l.qty })));
    },
    selTransferGoods() { return this.transferForm.goodsId ? S.byId('goods', this.transferForm.goodsId) : null; },
    transferFormAmount() { return U.round2((Number(this.transferForm.qty) || 0) * (Number(this.transferForm.costPrice) || 0)); },

    /* 通用下拉 */
    whOpts() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    typeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    supplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    orderOpts() { return [{ value: '', label: '全部订单号' }].concat(S.db.purchases.map(p => ({ value: p.no, label: p.no }))); },
    payMethodOpts() { return [{ value: '', label: '请选择' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m }))); },
    checkGoodsOpts() { return [{ value: '', label: '全部商品' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.name + '（' + g.sku + '）' }))); },
    checkFiltered() {
      return this.checkRows.filter(cr =>
        (!this.checkQ.whId || cr.whId === this.checkQ.whId) &&
        (!this.checkQ.goodsId || cr.goodsId === this.checkQ.goodsId)
      );
    },

    /* ---------- 库存明细（批次级：每个 lot 一行） ---------- */
    rows() {
      const base = S.db.stocks.filter(s => {
        const g = S.byId('goods', s.goodsId) || {};
        return (!this.q.whId || s.whId === this.q.whId) &&
          (!this.q.typeId || g.typeId === this.q.typeId) &&
          U.kw(g.name || '', this.q.name) &&
          (!this.q.supplierId || g.supplierId === this.q.supplierId) &&
          U.inRange(s.lastInTime || '', this.q.lastInT1, this.q.lastInT2);
      });
      const out = [];
      base.forEach(s => {
        const g = S.byId('goods', s.goodsId) || {};
        const lots = (s.lots && s.lots.length) ? s.lots : [{ batchNo: null, productionDate: null, qty: s.qty, cost: g.purchasePrice || 0, legacy: true }];
        lots.forEach(l => {
          const ei = S.lotExpiryInfo(g, l);
          out.push({
            id: s.id + '|' + (l.batchNo || 'legacy'), rec: s, lot: l, whId: s.whId, goodsId: s.goodsId,
            whName: S.name('warehouses', s.whId), goodsName: g.name || '', typeId: g.typeId, typeName: S.name('goodsTypes', g.typeId),
            sku: g.sku || '', unitName: S.name('units', g.unitId), supplierName: S.name('suppliers', g.supplierId),
            batchNo: l.batchNo || '未分批次', productionDate: l.productionDate || '-',
            expiryDate: ei.expiryDate || '-', days: ei.expiryDate ? ei.days : '',
            qty: l.qty, expiring: ei.expiring, minStock: g.minStock || 0,
            cost: U.round2(l.qty * (g.purchasePrice || 0)), value: U.round2(l.qty * (g.retailPrice || 0)),
            lastInTime: s.lastInTime || '-', lastCheckTime: s.lastCheckTime || '-'
          });
        });
      });
      return out.sort((a, b) => a.whName.localeCompare(b.whName) || a.goodsName.localeCompare(b.goodsName) || (a.expiryDate || '').localeCompare(b.expiryDate || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    totals() {
      return {
        qty: this.rows.reduce((a, r) => a + r.qty, 0),
        cost: U.round2(this.rows.reduce((a, r) => a + r.cost, 0)),
        value: U.round2(this.rows.reduce((a, r) => a + r.value, 0))
      };
    },

    /* ---------- 报损 ---------- */
    formLossGoods() { return S.enabled('goods').filter(g => !this.lossForm.typeId || g.typeId === this.lossForm.typeId); },
    lossFormGoodsOpts() { return [{ value: '', label: '请选择' }].concat(this.formLossGoods.map(g => ({ value: g.id, label: g.name + '（' + g.sku + '）' }))); },
    lossRows() {
      return S.db.losses.filter(l =>
        (!this.lossQ.orderNo || (l.orderNo || '').indexOf(this.lossQ.orderNo) >= 0) &&
        (!this.lossQ.typeId || l.typeId === this.lossQ.typeId) &&
        U.kw(S.name('goods', l.goodsId), this.lossQ.name) &&
        (!this.lossQ.supplierId || l.supplierId === this.lossQ.supplierId) &&
        (!this.lossQ.whId || l.whId === this.lossQ.whId) &&
        U.inRange(l.time, this.lossQ.t1, this.lossQ.t2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    lossPaged() { return this.lossRows.slice((this.lossPage - 1) * this.lossSize, this.lossPage * this.lossSize); },
    lossAmountSum() { return U.round2(this.lossRows.reduce((a, l) => a + Number(l.amount || 0), 0)); },
    selLossGoods() { return this.lossForm.goodsId ? S.byId('goods', this.lossForm.goodsId) : null; },
    lossFormAmount() { return U.round2((Number(this.lossForm.qty) || 0) * (Number(this.lossForm.price) || 0)); },

    /* ---------- 报溢 ---------- */
    formOvGoods() { return S.enabled('goods').filter(g => !this.ovForm.typeId || g.typeId === this.ovForm.typeId); },
    ovFormGoodsOpts() { return [{ value: '', label: '请选择' }].concat(this.formOvGoods.map(g => ({ value: g.id, label: g.name + '（' + g.sku + '）' }))); },
    ovRows() {
      return S.db.overflows.filter(o =>
        (!this.ovQ.orderNo || (o.orderNo || '').indexOf(this.ovQ.orderNo) >= 0) &&
        (!this.ovQ.typeId || o.typeId === this.ovQ.typeId) &&
        U.kw(S.name('goods', o.goodsId), this.ovQ.name) &&
        (!this.ovQ.supplierId || o.supplierId === this.ovQ.supplierId) &&
        (!this.ovQ.whId || o.whId === this.ovQ.whId) &&
        U.inRange(o.time, this.ovQ.t1, this.ovQ.t2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    ovPaged() { return this.ovRows.slice((this.ovPage - 1) * this.ovSize, this.ovPage * this.ovSize); },
    ovAmountSum() { return U.round2(this.ovRows.reduce((a, o) => a + Number(o.amount || 0), 0)); },
    selOvGoods() { return this.ovForm.goodsId ? S.byId('goods', this.ovForm.goodsId) : null; },
    ovFormAmount() { return U.round2((Number(this.ovForm.qty) || 0) * (Number(this.ovForm.price) || 0)); }
  },
  watch: {
    'lossForm.orderNo'(no) {
      if (this.editingLoss) return;
      const p = S.db.purchases.find(x => x.no === no);
      if (p) { this.lossForm.goodsId = p.goodsId; this.lossForm.whId = p.whId; }
    },
    'lossForm.goodsId'(v) {
      if (this.editingLoss) return;
      const g = v ? S.byId('goods', v) : null;
      if (g) { this.lossForm.typeId = g.typeId; this.lossForm.supplierId = g.supplierId; this.lossForm.price = g.purchasePrice; }
    },
    'ovForm.orderNo'(no) {
      if (this.editingOv) return;
      const p = S.db.purchases.find(x => x.no === no);
      if (p) { this.ovForm.goodsId = p.goodsId; this.ovForm.whId = p.whId; }
    },
    'ovForm.goodsId'(v) {
      if (this.editingOv) return;
      const g = v ? S.byId('goods', v) : null;
      if (g) { this.ovForm.typeId = g.typeId; this.ovForm.supplierId = g.supplierId; this.ovForm.price = g.purchasePrice; }
    },
    'transferForm.fromWhId'(v) {
      if (this.editingTransfer) return;
      this.transferForm.goodsId = ''; this.transferForm.batchNo = '';
      this.transferForm.costPrice = null; this.transferForm.productionDate = '';
      this.transferForm.shelfLife = 0; this.transferForm.expiryDate = '';
    },
    'transferForm.goodsId'(v) {
      if (this.editingTransfer) return;
      this.transferForm.batchNo = '';
      const g = v ? S.byId('goods', v) : null;
      if (g) {
        this.transferForm.shelfLife = g.shelfLife || 0;
        this.transferForm.costPrice = g.purchasePrice;
        this.transferForm.productionDate = ''; this.transferForm.expiryDate = '';
      }
    },
    'transferForm.batchNo'(v) {
      if (this.editingTransfer) return;
      const realBatch = (v && v !== '__NONE__') ? v : null;
      const rec = S.stockRec(this.transferForm.fromWhId, this.transferForm.goodsId, false);
      const lot = rec && rec.lots ? rec.lots.find(l => l.batchNo === realBatch) : null;
      const g = this.selTransferGoods;
      if (lot) { this.transferForm.costPrice = lot.cost; this.transferForm.productionDate = lot.productionDate || ''; }
      else if (g) { this.transferForm.costPrice = g.purchasePrice; this.transferForm.productionDate = ''; }
      if (g) {
        this.transferForm.shelfLife = g.shelfLife || 0;
        this.transferForm.expiryDate = (lot && lot.productionDate) ? U.addDays(lot.productionDate, g.shelfLife || 0) : '';
      }
    },
    'transferForm.qty'(v) {
      if (this.editingTransfer) return;
      this.transferForm.amount = U.round2((Number(v) || 0) * (Number(this.transferForm.costPrice) || 0));
    },
    'transferForm.costPrice'(v) {
      if (this.editingTransfer) return;
      this.transferForm.amount = U.round2((Number(this.transferForm.qty) || 0) * (Number(v) || 0));
    }
  },
  methods: {
    fmtMoney: U.fmtMoney, fmtNum: U.fmtNum,
    /* 库存明细 */
    rowFields(r) {
      return [
        { label: '仓库名称', value: r.whName },
        { label: '商品名称', value: r.goodsName },
        { label: '商品类型', value: r.typeName },
        { label: 'SKU', value: r.sku || '-' },
        { label: '单位', value: r.unitName },
        { label: '供应商', value: r.supplierName },
        { label: '批次号', value: r.batchNo },
        { label: '生产日期', value: r.productionDate },
        { label: '到期日', value: r.expiryDate },
        { label: '临期天数', value: r.days },
        { label: '当前库存', value: r.qty },
        { label: '最低库存', value: r.minStock },
        { label: '库存成本', value: U.fmtMoney(r.cost) },
        { label: '库存价值', value: U.fmtMoney(r.value) },
        { label: '最后入库时间', value: r.lastInTime },
        { label: '最近盘库时间', value: r.lastCheckTime }
      ];
    },
    openCheck() {
      if (!this.rows.length) return alert('当前筛选条件下没有库存记录');
      this.checkQ = { whId: '', goodsId: '' };
      this.checkRows = this.rows.map(r => ({
        rec: r.rec, lot: r.lot, whId: r.whId, goodsId: r.goodsId, whName: r.whName, goodsName: r.goodsName,
        sku: r.sku, unitName: r.unitName, batchNo: r.batchNo, qty: r.qty, actual: r.qty
      }));
      this.showCheck = true;
    },
    submitCheck() {
      let changed = 0;
      const t = U.now();
      this.checkRows.forEach(cr => {
        const actual = Number(cr.actual);
        if (isNaN(actual) || actual < 0) return;
        if (cr.lot.legacy) {
          if (actual !== cr.rec.qty) {
            S.db.stockChecks.push({ id: S.genId(), whId: cr.rec.whId, goodsId: cr.rec.goodsId, before: cr.rec.qty, after: actual, diff: actual - cr.rec.qty, time: t });
            cr.rec.qty = actual; changed++;
          }
        } else {
          if (actual !== cr.lot.qty) {
            S.db.stockChecks.push({ id: S.genId(), whId: cr.rec.whId, goodsId: cr.rec.goodsId, batchNo: cr.lot.batchNo || null, before: cr.lot.qty, after: actual, diff: actual - cr.lot.qty, time: t });
            cr.lot.qty = actual;
            cr.rec.lots = (cr.rec.lots || []).filter(x => x.qty > 0);
            cr.rec.qty = U.round2((cr.rec.lots || []).reduce((a, x) => a + Number(x.qty || 0), 0));
            changed++;
          }
        }
        cr.rec.lastCheckTime = t;
      });
      this.showCheck = false;
      alert('盘库完成：共盘点 ' + this.checkRows.length + ' 条记录，其中 ' + changed + ' 条有差异并已修正库存');
    },
    exportData() {
      U.exportExcel('库存明细.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '仓库名称': r.whName, '商品名称': r.goodsName, '商品类型': r.typeName,
        'SKU': r.sku, '商品单位': r.unitName, '供应商': r.supplierName,
        '批次号': r.batchNo, '生产日期': r.productionDate, '到期日': r.expiryDate, '临期天数': r.days,
        '当前库存': r.qty, '最低库存': r.minStock, '临期库存': r.expiring ? r.qty : 0, '库存成本': r.cost, '库存价值': r.value,
        '最后一次入库时间': r.lastInTime, '最近一次盘库时间': r.lastCheckTime
      })));
    },
    /* 报损 */
    openLossNew() {
      this.editingLoss = null;
      this.lossForm = { orderNo: '', typeId: '', goodsId: '', supplierId: '', whId: '', qty: null, price: null, refundMethod: '', time: U.today() };
      this.showLossForm = true;
    },
    openLossEdit(l) {
      this.editingLoss = l;
      this.lossForm = { orderNo: l.orderNo || '', typeId: l.typeId, goodsId: l.goodsId, supplierId: l.supplierId, whId: l.whId, qty: l.qty, price: l.price, refundMethod: l.refundMethod || '', time: l.time };
      this.showLossForm = true;
    },
    saveLoss() {
      const f = this.lossForm;
      if (!f.goodsId) return alert('请选择商品');
      if (!f.qty || f.qty <= 0) return alert('请填写报损数量');
      if (f.price == null || f.price < 0) return alert('请填写报损单价');
      if (!f.whId) return alert('请选择报损仓库');
      const g = S.byId('goods', f.goodsId);
      if (this.editingLoss) {
        const err = S.updateLoss(this.editingLoss.id, { orderNo: f.orderNo, typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId, unitId: g.unitId, qty: Number(f.qty), price: Number(f.price), whId: f.whId, refundMethod: f.refundMethod, time: f.time });
        if (err) return alert(err);
      } else {
        S.addLoss({ orderNo: f.orderNo || '', typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId, unitId: g.unitId, qty: Number(f.qty), price: Number(f.price), whId: f.whId, refundMethod: f.refundMethod || '', time: f.time });
      }
      this.showLossForm = false; this.editingLoss = null;
    },
    delLoss(l) {
      if (!U.confirm('删除报损单将回滚对应库存（' + S.name('goods', l.goodsId) + ' × ' + l.qty + '），确定删除吗？')) return;
      const err = S.deleteLoss(l.id); if (err) alert(err);
    },
    exportLoss() {
      U.exportExcel('报损明细.xlsx', this.lossRows.map((l, i) => ({
        '序号': i + 1, '订单号': l.orderNo || '', '商品类型': S.name('goodsTypes', l.typeId), '商品名称': S.name('goods', l.goodsId),
        '供应商': S.name('suppliers', l.supplierId), '单位': S.name('units', l.unitId), '报损单价': l.price, '报损数量': l.qty,
        '退款金额': l.amount, '报损仓库': S.name('warehouses', l.whId), '退款方式': l.refundMethod || '', '报损时间': l.time
      })));
    },
    /* 报溢 */
    openOvNew() {
      this.editingOv = null;
      this.ovForm = { orderNo: '', typeId: '', goodsId: '', supplierId: '', whId: '', qty: null, price: null, payMethod: '', time: U.today() };
      this.showOvForm = true;
    },
    openOvEdit(o) {
      this.editingOv = o;
      this.ovForm = { orderNo: o.orderNo || '', typeId: o.typeId, goodsId: o.goodsId, supplierId: o.supplierId, whId: o.whId, qty: o.qty, price: o.price, payMethod: o.payMethod || '', time: o.time };
      this.showOvForm = true;
    },
    saveOv() {
      const f = this.ovForm;
      if (!f.goodsId) return alert('请选择商品');
      if (!f.qty || f.qty <= 0) return alert('请填写报溢数量');
      if (f.price == null || f.price < 0) return alert('请填写报溢单价');
      if (!f.whId) return alert('请选择报溢仓库');
      const g = S.byId('goods', f.goodsId);
      if (this.editingOv) {
        const err = S.updateOverflow(this.editingOv.id, { orderNo: f.orderNo, typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId, unitId: g.unitId, qty: Number(f.qty), price: Number(f.price), whId: f.whId, payMethod: f.payMethod, time: f.time });
        if (err) return alert(err);
      } else {
        S.addOverflow({ orderNo: f.orderNo || '', typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId, unitId: g.unitId, qty: Number(f.qty), price: Number(f.price), whId: f.whId, payMethod: f.payMethod || '', time: f.time });
      }
      this.showOvForm = false; this.editingOv = null;
    },
    delOv(o) {
      if (!U.confirm('删除报溢单将回滚对应库存（' + S.name('goods', o.goodsId) + ' × ' + o.qty + '），确定删除吗？')) return;
      const err = S.deleteOverflow(o.id); if (err) alert(err);
    },
    exportOv() {
      U.exportExcel('报溢明细.xlsx', this.ovRows.map((o, i) => ({
        '序号': i + 1, '订单号': o.orderNo || '', '商品类型': S.name('goodsTypes', o.typeId), '商品名称': S.name('goods', o.goodsId),
        '供应商': S.name('suppliers', o.supplierId), '单位': S.name('units', o.unitId), '报溢单价': o.price, '报溢数量': o.qty,
        '报溢金额': o.amount, '报溢仓库': S.name('warehouses', o.whId), '支付方式': o.payMethod || '', '报溢时间': o.time
      })));
    },
    /* ---------- 调拨 ---------- */
    openTransferNew() {
      this.editingTransfer = null;
      this.transferForm = { fromWhId: '', toWhId: '', goodsId: '', batchNo: '', qty: null, costPrice: null, amount: null, productionDate: '', shelfLife: 0, expiryDate: '', logisticsFee: null, time: U.today(), remark: '' };
      this.showTransferForm = true;
    },
    openTransferEdit(t) {
      this.editingTransfer = t;
      this.transferForm = {
        fromWhId: t.fromWhId, toWhId: t.toWhId, goodsId: t.goodsId,
        batchNo: t.batchNo == null ? '__NONE__' : (t.batchNo || ''),
        qty: t.qty, costPrice: t.costPrice, amount: t.amount,
        productionDate: t.productionDate || '', shelfLife: t.shelfLife || 0, expiryDate: t.expiryDate || '',
        logisticsFee: t.logisticsFee, time: t.time, remark: t.remark || ''
      };
      this.showTransferForm = true;
    },
    saveTransfer() {
      const f = this.transferForm;
      if (!f.fromWhId) return alert('请选择发货仓库');
      if (!f.toWhId) return alert('请选择收货仓库');
      if (f.fromWhId === f.toWhId) return alert('发货仓库与收货仓库不能相同');
      if (!f.goodsId) return alert('请选择商品');
      if (!f.batchNo && f.batchNo !== '__NONE__') return alert('请选择批次号');
      if (!f.qty || f.qty <= 0) return alert('请填写调拨数量');
      if (f.costPrice == null || f.costPrice < 0) return alert('请填写成本单价');
      const g = S.byId('goods', f.goodsId);
      const batchNo = (f.batchNo && f.batchNo !== '__NONE__') ? f.batchNo : null;
      const amount = U.round2((Number(f.qty)) * (Number(f.costPrice)));
      const expiryDate = (f.productionDate && g && g.shelfLife) ? U.addDays(f.productionDate, g.shelfLife) : '';
      const data = {
        fromWhId: f.fromWhId, toWhId: f.toWhId, goodsId: f.goodsId, batchNo,
        qty: Number(f.qty), costPrice: Number(f.costPrice), amount,
        productionDate: f.productionDate || null, shelfLife: Number(g ? g.shelfLife : 0) || 0,
        expiryDate, logisticsFee: Number(f.logisticsFee) || 0, time: f.time, remark: f.remark
      };
      if (this.editingTransfer) {
        const err = S.updateTransfer(this.editingTransfer.id, data);
        if (err) return alert(err);
      } else {
        S.addTransfer(data);
      }
      this.showTransferForm = false; this.editingTransfer = null;
    },
    activateTransfer(t) {
      if (!U.confirm('生效后将从「' + S.name('warehouses', t.fromWhId) + '」调拨 ' + t.qty + ' 件至「' + S.name('warehouses', t.toWhId) + '」，确定生效吗？')) return;
      const err = S.activateTransfer(t.id); if (err) alert(err);
    },
    reverseTransfer(t) {
      if (!U.confirm('撤销将回滚该调拨单的库存与物流费成本，确定撤销吗？')) return;
      const err = S.reverseTransfer(t.id); if (err) alert(err);
    },
    delTransfer(t) {
      if (!U.confirm('删除调拨单' + (t.status === '已生效' ? '将回滚对应库存' : '') + '，确定删除吗？')) return;
      const err = S.deleteTransfer(t.id); if (err) alert(err);
    },
    exportTransfer() {
      U.exportExcel('调拨明细.xlsx', this.transferRows.map((t, i) => ({
        '序号': i + 1, '发货仓库': S.name('warehouses', t.fromWhId), '商品名称': S.name('goods', t.goodsId),
        '批次号': t.batchNo || '未分批次', '数量': t.qty, '成本单价': t.costPrice, '成本金额': t.amount,
        '生产日期': t.productionDate || '', '保质期(天)': t.shelfLife, '到期时间': t.expiryDate || '',
        '物流费用': t.logisticsFee, '收货仓库': S.name('warehouses', t.toWhId), '调拨时间': t.time,
        '状态': t.status, '备注': t.remark || ''
      })));
    },

    /* ---------- 生产组装 ---------- */
    openProdNew() {
      this.editingProd = null;
      this.prodForm = {
        goodsName: '', typeId: '', unitId: '', supplierId: this.selfSupplierId || '', sku: '',
        items: [], laborFee: 0, qty: null, retailPrice: null, bigPrice: null, wholesalePrice: null,
        shelfLife: 0, expireWarn: 0, whId: '', batchNo: S.genScBatch(), time: U.today(), remark: ''
      };
      this.showProdForm = true;
    },
    openProdEdit(p) {
      this.editingProd = p;
      this.prodForm = {
        goodsName: p.goodsName, typeId: p.typeId, unitId: p.unitId,
        supplierId: p.supplierId || (this.selfSupplierId || ''), sku: p.sku || '',
        items: (p.items || []).map(it => ({ ...it })),
        laborFee: p.laborFee || 0, qty: p.qty, retailPrice: p.retailPrice, bigPrice: p.bigPrice, wholesalePrice: p.wholesalePrice,
        shelfLife: p.shelfLife || 0, expireWarn: p.expireWarn || 0, whId: p.whId,
        batchNo: p.batchNo, time: p.time, remark: p.remark || ''
      };
      this.showProdForm = true;
    },
    saveProd() {
      const f = this.prodForm;
      if (!f.goodsName || !f.goodsName.trim()) return alert('请填写新商品名称');
      if (!f.typeId) return alert('请选择商品类型');
      if (!f.unitId) return alert('请选择商品单位');
      if (!f.qty || f.qty <= 0) return alert('请填写生产数量');
      if (f.retailPrice == null || f.retailPrice < 0) return alert('请填写零售价');
      if (!f.whId) return alert('请选择入库仓库');
      if (!f.batchNo) return alert('批次号不能为空');
      const items = (f.items || []).map(it => ({
        whId: it.whId, goodsId: it.goodsId, unitId: it.unitId,
        qty: Number(it.qty) || 0, price: Number(it.price) || 0,
        amount: U.round2(Number(it.amount) || 0),
        batchNo: (it.batchNo && it.batchNo !== '__NONE__') ? it.batchNo : null,
        productionDate: it.productionDate || null, shelfLife: Number(it.shelfLife) || 0,
        expiryDate: it.expiryDate || null, remark: it.remark || '', goodsName: S.name('goods', it.goodsId)
      }));
      const data = {
        goodsName: f.goodsName.trim(), typeId: f.typeId, unitId: f.unitId, supplierId: f.supplierId || null, sku: f.sku || '',
        items, laborFee: Number(f.laborFee) || 0, qty: Number(f.qty),
        costPrice: this.prodFormCostPrice, amount: this.prodFormAmount,
        retailPrice: Number(f.retailPrice), bigPrice: Number(f.bigPrice) || Number(f.retailPrice), wholesalePrice: Number(f.wholesalePrice) || Number(f.retailPrice),
        shelfLife: Number(f.shelfLife) || 0, expireWarn: Number(f.expireWarn) || 0,
        whId: f.whId, batchNo: f.batchNo, time: f.time, remark: f.remark || ''
      };
      if (this.editingProd) {
        const err = S.updateProduction(this.editingProd.id, data);
        if (err) return alert(err);
      } else {
        S.addProduction(data);
      }
      this.showProdForm = false; this.editingProd = null;
    },
    completeProd(p) {
      if (!U.confirm('完成后将消耗原材料库存、生成新商品「' + p.goodsName + '」并入库，确定完成吗？')) return;
      const err = S.completeProduction(p.id); if (err) alert(err);
    },
    delProd(p) {
      const msg = p.status === '已完成' ? '已完成的生产单删除将回滚原材料库存与成品入库，确定删除吗？' : '确定删除该生产单吗？';
      if (!U.confirm(msg)) return;
      const err = S.deleteProduction(p.id); if (err) alert(err);
    },
    exportProd() {
      U.exportExcel('生产组装明细.xlsx', this.prodRows.map((p, i) => ({
        '序号': i + 1, '商品名称': p.goodsName, '商品类型': S.name('goodsTypes', p.typeId),
        '商品单位': S.name('units', p.unitId), '供应商': S.name('suppliers', p.supplierId), 'SKU': p.sku || '',
        '生产数量': p.qty, '成本价': p.costPrice, '金额': p.amount, '零售价': p.retailPrice, '大客价': p.bigPrice, '批发价': p.wholesalePrice,
        '生产工费': p.laborFee, '入库仓库': S.name('warehouses', p.whId), '批次号': p.batchNo, '生产时间': p.time,
        '状态': p.status, '备注': p.remark || ''
      })));
    },
    /* 所需商品清单（BOM）子表 */
    addProdItem() {
      this.prodForm.items.push({ whId: '', goodsId: '', unitId: '', qty: null, price: null, amount: 0, batchNo: '', productionDate: '', shelfLife: 0, expiryDate: '', remark: '' });
    },
    delProdItem(idx) { this.prodForm.items.splice(idx, 1); },
    recalcItem(it) { it.amount = U.round2((Number(it.qty) || 0) * (Number(it.price) || 0)); },
    onProdItemWh(it) { it.goodsId = ''; it.batchNo = ''; it.unitId = ''; it.price = null; it.productionDate = ''; it.shelfLife = 0; it.expiryDate = ''; },
    onProdItemGoods(it) {
      it.batchNo = ''; it.price = null; it.productionDate = ''; it.shelfLife = 0; it.expiryDate = ''; it.goodsName = '';
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      if (g) { it.unitId = g.unitId; it.goodsName = g.name; }
    },
    onProdItemBatch(it) {
      const realBatch = (it.batchNo && it.batchNo !== '__NONE__') ? it.batchNo : null;
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      const rec = it.whId ? S.stockRec(it.whId, it.goodsId, false) : null;
      const lot = rec && rec.lots ? rec.lots.find(l => l.batchNo === realBatch) : null;
      if (lot) { it.price = lot.cost; it.productionDate = lot.productionDate || ''; }
      else if (g) { it.price = g.purchasePrice; it.productionDate = ''; }
      if (g) { it.shelfLife = g.shelfLife || 0; it.expiryDate = (lot && lot.productionDate) ? U.addDays(lot.productionDate, g.shelfLife || 0) : ''; }
      this.recalcItem(it);
    },
    prodItemGoodsOpts(whId) {
      if (!whId) return [{ value: '', label: '请先选择源仓库' }];
      const ids = new Set(S.db.stocks.filter(s => s.whId === whId && s.qty > 0).map(s => s.goodsId));
      return [{ value: '', label: '请选择商品' }].concat(S.enabled('goods').filter(g => ids.has(g.id)).map(g => ({ value: g.id, label: g.name + '（' + g.sku + '）' })));
    },
    prodItemBatchOpts(it) {
      if (!it.whId || !it.goodsId) return [{ value: '', label: '请选择批次' }];
      const rec = S.stockRec(it.whId, it.goodsId, false);
      if (!rec || !rec.lots || !rec.lots.length) return [{ value: '', label: '无批次库存' }];
      return [{ value: '', label: '请选择批次' }].concat(rec.lots.filter(l => l.qty > 0)
        .sort((a, b) => (a.productionDate || '').localeCompare(b.productionDate || ''))
        .map(l => ({ value: l.batchNo == null ? '__NONE__' : l.batchNo, label: (l.batchNo || '未分批次') + ' / 产 ' + (l.productionDate || '-') + ' / 余 ' + l.qty })));
    }
  },
  template: `
  <div>
    <div class="page-title">库存管理</div>
    <div class="tabs">
      <div class="tab" :class="{active:tab==='stock'}" @click="tab='stock'">库存明细</div>
      <div class="tab" v-if="canLoss" :class="{active:tab==='loss'}" @click="tab='loss'">报损管理</div>
      <div class="tab" v-if="canOv" :class="{active:tab==='overflow'}" @click="tab='overflow'">报溢管理</div>
      <div class="tab" :class="{active:tab==='transfer'}" @click="tab='transfer'">调拨管理</div>
      <div class="tab" :class="{active:tab==='prod'}" @click="tab='prod'">生产组装</div>
    </div>

    <!-- ===== 库存明细 ===== -->
    <div v-show="tab==='stock'" class="card">
      <div class="toolbar">
        <x-combobox v-model="q.whId" :options="whOpts" style="width:140px"/>
        <x-combobox v-model="q.typeId" :options="typeOpts" style="width:140px"/>
        <input type="text" v-model="q.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="q.supplierId" :options="supplierOpts" style="width:150px"/>
        <span class="muted">最后入库</span><input type="date" v-model="q.lastInT1"> - <input type="date" v-model="q.lastInT2">
        <div class="spacer"></div>
        <span class="muted">合计：{{fmtNum(totals.qty)}} 件 / 成本 ￥{{fmtMoney(totals.cost)}} / 价值 ￥{{fmtMoney(totals.value)}}</span>
        <button class="btn" @click="exportData">导出</button>
        <button class="btn btn-primary" @click="openCheck">批量盘库</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>仓库名称</th><th>商品名称</th><th>商品类型</th><th>SKU</th><th>单位</th><th>供应商</th>
          <th>批次号</th><th>生产日期</th><th>到期日</th><th class="num">临期天数</th>
          <th class="num">当前库存</th><th class="num">最低库存</th><th class="num">临期库存</th><th class="num">库存成本</th><th class="num">库存价值</th>
          <th>最后入库时间</th><th>最近盘库时间</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged" :key="r.id">
            <td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="仓库名称">{{r.whName}}</td><td data-label="商品名称">{{r.goodsName}}</td><td data-label="商品类型">{{r.typeName}}</td>
            <td data-label="SKU">{{r.sku}}</td><td data-label="单位">{{r.unitName}}</td><td data-label="供应商">{{r.supplierName}}</td>
            <td data-label="批次号">{{r.batchNo}}</td><td data-label="生产日期">{{r.productionDate}}</td><td data-label="到期日">{{r.expiryDate}}</td>
            <td class="num" :class="{red: r.expiring}" data-label="临期天数">{{r.days}}</td>
            <td class="num" :class="{red: r.qty < r.minStock}" data-label="当前库存"><b>{{r.qty}}</b>
              <span v-if="r.qty < r.minStock" class="tag tag-red">低于下限</span></td>
            <td class="num" data-label="最低库存">{{r.minStock}}</td>
            <td class="num" :class="{red: r.expiring}" data-label="临期库存">{{r.expiring ? r.qty : 0}}</td>
            <td class="num money" data-label="库存成本">{{fmtMoney(r.cost)}}</td><td class="num money" data-label="库存价值">{{fmtMoney(r.value)}}</td>
            <td data-label="最后入库时间">{{r.lastInTime}}</td><td data-label="最近盘库时间">{{r.lastCheckTime}}</td>
          </tr>
          <tr v-if="!paged.length"><td colspan="18" class="empty">暂无库存记录（采购入库后自动生成）</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <!-- ===== 报损管理 ===== -->
    <div v-show="tab==='loss'" class="card">
      <div class="toolbar">
        <x-combobox v-model="lossQ.orderNo" :options="orderOpts" style="width:170px" placeholder="订单号"/>
        <x-combobox v-model="lossQ.typeId" :options="typeOpts" style="width:140px"/>
        <input type="text" v-model="lossQ.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="lossQ.supplierId" :options="supplierOpts" style="width:150px"/>
        <x-combobox v-model="lossQ.whId" :options="whOpts" style="width:140px"/>
        <span class="muted">报损时间</span><input type="date" v-model="lossQ.t1"> - <input type="date" v-model="lossQ.t2">
        <div class="spacer"></div>
        <span class="muted">退款金额合计 ￥{{fmtMoney(lossAmountSum)}}</span>
        <button class="btn" @click="exportLoss">导出</button>
        <button v-if="canLossEdit" class="btn btn-primary" @click="openLossNew">+ 新增报损单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>订单号</th><th>商品类型</th><th>商品名称</th><th>供应商</th><th>单位</th>
          <th class="num">报损单价</th><th class="num">报损数量</th><th class="num">退款金额</th><th>报损仓库</th><th>退款方式</th><th>报损时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(l,i) in lossPaged" :key="l.id">
            <td data-label="序号">{{(lossPage-1)*lossSize+i+1}}</td>
            <td data-label="订单号">{{l.orderNo||'—'}}</td>
            <td data-label="商品类型">{{S.name('goodsTypes',l.typeId)}}</td>
            <td data-label="商品名称">{{S.name('goods',l.goodsId)}}</td>
            <td data-label="供应商">{{S.name('suppliers',l.supplierId)}}</td>
            <td data-label="单位">{{S.name('units',l.unitId)}}</td>
            <td class="num money" data-label="报损单价">{{fmtMoney(l.price)}}</td>
            <td class="num" data-label="报损数量">{{l.qty}}</td>
            <td class="num money" data-label="退款金额">{{fmtMoney(l.amount)}}</td>
            <td data-label="报损仓库">{{S.name('warehouses',l.whId)}}</td>
            <td data-label="退款方式">{{l.refundMethod||'—'}}</td>
            <td data-label="报损时间">{{l.time}}</td>
            <td class="ops" data-label="操作"><template v-if="canLossEdit">
              <span class="link" @click="openLossEdit(l)">修改</span>
              <span class="link danger" @click="delLoss(l)">删除</span>
            </template><span v-else class="muted">查看</span></td>
          </tr>
          <tr v-if="!lossPaged.length"><td colspan="13" class="empty">暂无报损记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="lossRows.length" v-model:page="lossPage" v-model:size="lossSize"/>
    </div>

    <!-- ===== 报溢管理 ===== -->
    <div v-show="tab==='overflow'" class="card">
      <div class="toolbar">
        <x-combobox v-model="ovQ.orderNo" :options="orderOpts" style="width:170px" placeholder="订单号"/>
        <x-combobox v-model="ovQ.typeId" :options="typeOpts" style="width:140px"/>
        <input type="text" v-model="ovQ.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="ovQ.supplierId" :options="supplierOpts" style="width:150px"/>
        <x-combobox v-model="ovQ.whId" :options="whOpts" style="width:140px"/>
        <span class="muted">报溢时间</span><input type="date" v-model="ovQ.t1"> - <input type="date" v-model="ovQ.t2">
        <div class="spacer"></div>
        <span class="muted">报溢金额合计 ￥{{fmtMoney(ovAmountSum)}}</span>
        <button class="btn" @click="exportOv">导出</button>
        <button v-if="canOvEdit" class="btn btn-primary" @click="openOvNew">+ 新增报溢单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>订单号</th><th>商品类型</th><th>商品名称</th><th>供应商</th><th>单位</th>
          <th class="num">报溢单价</th><th class="num">报溢数量</th><th class="num">报溢金额</th><th>报溢仓库</th><th>支付方式</th><th>报溢时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(o,i) in ovPaged" :key="o.id">
            <td data-label="序号">{{(ovPage-1)*ovSize+i+1}}</td>
            <td data-label="订单号">{{o.orderNo||'—'}}</td>
            <td data-label="商品类型">{{S.name('goodsTypes',o.typeId)}}</td>
            <td data-label="商品名称">{{S.name('goods',o.goodsId)}}</td>
            <td data-label="供应商">{{S.name('suppliers',o.supplierId)}}</td>
            <td data-label="单位">{{S.name('units',o.unitId)}}</td>
            <td class="num money" data-label="报溢单价">{{fmtMoney(o.price)}}</td>
            <td class="num" data-label="报溢数量">{{o.qty}}</td>
            <td class="num money" data-label="报溢金额">{{fmtMoney(o.amount)}}</td>
            <td data-label="报溢仓库">{{S.name('warehouses',o.whId)}}</td>
            <td data-label="支付方式">{{o.payMethod||'—'}}</td>
            <td data-label="报溢时间">{{o.time}}</td>
            <td class="ops" data-label="操作"><template v-if="canOvEdit">
              <span class="link" @click="openOvEdit(o)">修改</span>
              <span class="link danger" @click="delOv(o)">删除</span>
            </template><span v-else class="muted">查看</span></td>
          </tr>
          <tr v-if="!ovPaged.length"><td colspan="13" class="empty">暂无报溢记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="ovRows.length" v-model:page="ovPage" v-model:size="ovSize"/>
    </div>

    <!-- ===== 调拨管理 ===== -->
    <div v-show="tab==='transfer'" class="card">
      <div class="toolbar">
        <input type="text" v-model="transferQ.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="transferQ.fromWhId" :options="whOpts" style="width:140px" placeholder="发货仓库"/>
        <x-combobox v-model="transferQ.toWhId" :options="whOpts" style="width:140px" placeholder="收货仓库"/>
        <span class="muted">调拨时间</span><input type="date" v-model="transferQ.t1"> - <input type="date" v-model="transferQ.t2">
        <div class="spacer"></div>
        <span class="muted">成本金额合计 ￥{{fmtMoney(transferAmountSum)}} ｜ 物流费合计 ￥{{fmtMoney(transferLogisticsSum)}}</span>
        <button class="btn" @click="exportTransfer">导出</button>
        <button v-if="canTransferEdit" class="btn btn-primary" @click="openTransferNew">+ 新增调拨单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>发货仓库</th><th>商品名称</th><th>批次号</th><th class="num">数量</th>
          <th class="num">成本单价</th><th class="num">成本金额</th><th>生产日期</th><th class="num">保质期(天)</th>
          <th>到期时间</th><th class="num">物流费用</th><th>收货仓库</th><th>调拨时间</th><th>状态</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(t,i) in transferPaged" :key="t.id">
            <td data-label="序号">{{(transferPage-1)*transferSize+i+1}}</td>
            <td data-label="发货仓库">{{S.name('warehouses',t.fromWhId)}}</td>
            <td data-label="商品名称">{{S.name('goods',t.goodsId)}}</td>
            <td data-label="批次号">{{t.batchNo || '未分批次'}}</td>
            <td class="num" data-label="数量">{{t.qty}}</td>
            <td class="num money" data-label="成本单价">{{fmtMoney(t.costPrice)}}</td>
            <td class="num money" data-label="成本金额">{{fmtMoney(t.amount)}}</td>
            <td data-label="生产日期">{{t.productionDate || '-'}}</td>
            <td class="num" data-label="保质期(天)">{{t.shelfLife || 0}}</td>
            <td data-label="到期时间">{{t.expiryDate || '-'}}</td>
            <td class="num money" data-label="物流费用">{{fmtMoney(t.logisticsFee)}}</td>
            <td data-label="收货仓库">{{S.name('warehouses',t.toWhId)}}</td>
            <td data-label="调拨时间">{{t.time}}</td>
            <td data-label="状态"><x-status :v="t.status"/></td>
            <td data-label="备注">{{t.remark || '-'}}</td>
            <td class="ops" data-label="操作"><template v-if="canTransferEdit">
              <span v-if="t.status!=='已生效'" class="link" @click="openTransferEdit(t)">修改</span>
              <span v-if="t.status!=='已生效'" class="link danger" @click="delTransfer(t)">删除</span>
              <span v-if="t.status!=='已生效'" class="link green" @click="activateTransfer(t)">生效</span>
              <span v-if="t.status==='已生效'" class="link warn" @click="reverseTransfer(t)">撤销</span>
            </template><span v-else class="muted">查看</span></td>
          </tr>
          <tr v-if="!transferPaged.length"><td colspan="16" class="empty">暂无调拨记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="transferRows.length" v-model:page="transferPage" v-model:size="transferSize"/>
    </div>

    <!-- ===== 生产组装 ===== -->
    <div v-show="tab==='prod'" class="card">
      <div class="toolbar">
        <input type="text" v-model="prodQ.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="prodQ.typeId" :options="typeOpts" style="width:140px" placeholder="商品类型"/>
        <x-combobox v-model="prodQ.whId" :options="whOpts" style="width:140px" placeholder="入库仓库"/>
        <span class="muted">生产时间</span><input type="date" v-model="prodQ.t1"> - <input type="date" v-model="prodQ.t2">
        <div class="spacer"></div>
        <span class="muted">生产数量合计 {{fmtNum(prodQtySum)}} ｜ 金额合计 ￥{{fmtMoney(prodAmountSum)}}</span>
        <button class="btn" @click="exportProd">导出</button>
        <button v-if="canProdEdit" class="btn btn-primary" @click="openProdNew">+ 新增生产单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>商品名称</th><th>商品类型</th><th>商品单位</th><th>供应商</th><th>SKU</th>
          <th class="num">生产数量</th><th class="num">成本价</th><th class="num">金额</th>
          <th class="num">零售价</th><th class="num">大客价</th><th class="num">批发价</th>
          <th class="num">生产工费</th><th>入库仓库</th><th>批次号</th><th>生产时间</th><th>状态</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(p,i) in prodPaged" :key="p.id">
            <td data-label="序号">{{(prodPage-1)*prodSize+i+1}}</td>
            <td data-label="商品名称">{{p.goodsName}}</td>
            <td data-label="商品类型">{{S.name('goodsTypes',p.typeId)}}</td>
            <td data-label="商品单位">{{S.name('units',p.unitId)}}</td>
            <td data-label="供应商">{{S.name('suppliers',p.supplierId)}}</td>
            <td data-label="SKU">{{p.sku||'-'}}</td>
            <td class="num" data-label="生产数量">{{p.qty}}</td>
            <td class="num money" data-label="成本价">{{fmtMoney(p.costPrice)}}</td>
            <td class="num money" data-label="金额">{{fmtMoney(p.amount)}}</td>
            <td class="num money" data-label="零售价">{{fmtMoney(p.retailPrice)}}</td>
            <td class="num money" data-label="大客价">{{fmtMoney(p.bigPrice)}}</td>
            <td class="num money" data-label="批发价">{{fmtMoney(p.wholesalePrice)}}</td>
            <td class="num money" data-label="生产工费">{{fmtMoney(p.laborFee)}}</td>
            <td data-label="入库仓库">{{S.name('warehouses',p.whId)}}</td>
            <td data-label="批次号">{{p.batchNo}}</td>
            <td data-label="生产时间">{{p.time}}</td>
            <td data-label="状态"><x-status :v="p.status"/></td>
            <td data-label="备注">{{p.remark||'-'}}</td>
            <td class="ops" data-label="操作"><template v-if="canProdEdit">
              <span v-if="p.status!=='已完成'" class="link" @click="openProdEdit(p)">修改</span>
              <span v-if="p.status!=='已完成'" class="link danger" @click="delProd(p)">删除</span>
              <span v-if="p.status!=='已完成'" class="link green" @click="completeProd(p)">完成</span>
              <span v-if="p.status==='已完成'" class="link warn" @click="delProd(p)">删除(回滚)</span>
            </template><span v-else class="muted">查看</span></td>
          </tr>
          <tr v-if="!prodPaged.length"><td colspan="19" class="empty">暂无生产单记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="prodRows.length" v-model:page="prodPage" v-model:size="prodSize"/>
    </div>

    <!-- 批量盘库弹窗 -->
    <x-modal v-if="showCheck" title="批量盘库（修改实际库存后提交，差异自动留痕）" :width="720" :fullscreen="$root.isMobile" position="bottom" @close="showCheck=false">
      <div class="toolbar">
        <x-combobox v-model="checkQ.whId" :options="whOpts" style="width:140px" placeholder="仓库"/>
        <x-combobox v-model="checkQ.goodsId" :options="checkGoodsOpts" style="width:220px" placeholder="商品"/>
        <div class="spacer"></div>
        <span class="muted">共 {{checkFiltered.length}} 项</span>
      </div>
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr><th>仓库</th><th>商品</th><th>SKU</th><th>单位</th><th>批次号</th><th class="num">账面库存</th><th class="num" style="width:110px">实际库存</th><th class="num">差异</th></tr></thead>
        <tbody>
          <tr v-for="cr in checkFiltered" :key="(cr.whId||'')+(cr.goodsId||'')+(cr.sku||'')+(cr.batchNo||'')">
            <td data-label="仓库">{{cr.whName}}</td>
            <td data-label="商品">{{cr.goodsName}}</td>
            <td data-label="SKU">{{cr.sku}}</td>
            <td data-label="单位">{{cr.unitName}}</td>
            <td data-label="批次号">{{cr.batchNo}}</td>
            <td class="num" data-label="账面库存">{{cr.qty}}</td>
            <td class="num" data-label="实际库存"><input type="number" min="0" style="width:90px" v-model.number="cr.actual"></td>
            <td class="num" data-label="差异" :class="{red: cr.actual-cr.qty<0, 'green-t': cr.actual-cr.qty>0}">{{(cr.actual||0)-cr.qty}}</td>
          </tr>
          <tr v-if="!checkFiltered.length"><td colspan="8" class="empty">无匹配记录</td></tr>
        </tbody>
      </table>
      </div>
      <template #foot>
        <button class="btn" @click="showCheck=false">取消</button>
        <button class="btn btn-primary" @click="submitCheck">提交盘库结果</button>
      </template>
    </x-modal>

    <!-- 报损弹窗 -->
    <x-modal v-if="showLossForm" :title="editingLoss?'修改报损单':'新增报损单'" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showLossForm=false">
      <div class="form-grid">
        <div class="form-item"><label>订单号（关联采购单）</label>
          <x-combobox v-model="lossForm.orderNo" :options="orderOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品类型<b class="req">*</b></label>
          <x-combobox v-model="lossForm.typeId" :options="typeOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品名称<b class="req">*</b></label>
          <x-combobox v-model="lossForm.goodsId" :options="lossFormGoodsOpts" style="width:100%"/></div>
        <div class="form-item"><label>供应商（自动匹配）</label><input type="text" :value="selLossGoods?S.name('suppliers',selLossGoods.supplierId):''" disabled></div>
        <div class="form-item"><label>单位（自动匹配）</label><input type="text" :value="selLossGoods?S.name('units',selLossGoods.unitId):''" disabled></div>
        <div class="form-item"><label>报损数量<b class="req">*</b></label><input type="number" min="1" v-model.number="lossForm.qty"></div>
        <div class="form-item"><label>报损单价（自动匹配，可编辑）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="lossForm.price"></div>
        <div class="form-item"><label>退款金额（自动计算）</label><input type="text" :value="fmtMoney(lossFormAmount)" disabled></div>
        <div class="form-item"><label>报损仓库<b class="req">*</b></label>
          <x-combobox v-model="lossForm.whId" :options="whOpts" style="width:100%"/></div>
        <div class="form-item"><label>退款方式</label>
          <x-combobox v-model="lossForm.refundMethod" :options="payMethodOpts" style="width:100%"/></div>
        <div class="form-item"><label>报损时间<b class="req">*</b></label><input type="date" v-model="lossForm.time"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showLossForm=false">取消</button>
        <button class="btn btn-primary" @click="saveLoss">保存</button>
      </template>
    </x-modal>

    <!-- 报溢弹窗 -->
    <x-modal v-if="showOvForm" :title="editingOv?'修改报溢单':'新增报溢单'" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showOvForm=false">
      <div class="form-grid">
        <div class="form-item"><label>订单号（关联采购单）</label>
          <x-combobox v-model="ovForm.orderNo" :options="orderOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品类型<b class="req">*</b></label>
          <x-combobox v-model="ovForm.typeId" :options="typeOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品名称<b class="req">*</b></label>
          <x-combobox v-model="ovForm.goodsId" :options="ovFormGoodsOpts" style="width:100%"/></div>
        <div class="form-item"><label>供应商（自动匹配）</label><input type="text" :value="selOvGoods?S.name('suppliers',selOvGoods.supplierId):''" disabled></div>
        <div class="form-item"><label>单位（自动匹配）</label><input type="text" :value="selOvGoods?S.name('units',selOvGoods.unitId):''" disabled></div>
        <div class="form-item"><label>报溢数量<b class="req">*</b></label><input type="number" min="1" v-model.number="ovForm.qty"></div>
        <div class="form-item"><label>报溢单价（自动匹配，可编辑）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="ovForm.price"></div>
        <div class="form-item"><label>报溢金额（自动计算）</label><input type="text" :value="fmtMoney(ovFormAmount)" disabled></div>
        <div class="form-item"><label>报溢仓库<b class="req">*</b></label>
          <x-combobox v-model="ovForm.whId" :options="whOpts" style="width:100%"/></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="ovForm.payMethod" :options="payMethodOpts" style="width:100%"/></div>
        <div class="form-item"><label>报溢时间<b class="req">*</b></label><input type="date" v-model="ovForm.time"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showOvForm=false">取消</button>
        <button class="btn btn-primary" @click="saveOv">保存</button>
      </template>
    </x-modal>

    <!-- 调拨弹窗 -->
    <x-modal v-if="showTransferForm" :title="editingTransfer?'修改调拨单':'新增调拨单'" :width="680" :fullscreen="$root.isMobile" position="bottom" @close="showTransferForm=false">
      <div class="form-grid">
        <div class="form-item"><label>发货仓库<b class="req">*</b></label>
          <x-combobox v-model="transferForm.fromWhId" :options="whPickOpts" style="width:100%"/></div>
        <div class="form-item"><label>收货仓库<b class="req">*</b></label>
          <x-combobox v-model="transferForm.toWhId" :options="whPickOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品名称（发货仓库存）<b class="req">*</b></label>
          <x-combobox v-model="transferForm.goodsId" :options="fromWhGoodsOpts" style="width:100%"/></div>
        <div class="form-item"><label>批次号<b class="req">*</b></label>
          <x-combobox v-model="transferForm.batchNo" :options="fromWhBatchOpts" style="width:100%"/></div>
        <div class="form-item"><label>调拨数量<b class="req">*</b></label><input type="number" min="1" v-model.number="transferForm.qty"></div>
        <div class="form-item"><label>成本单价（自动匹配，可编辑）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="transferForm.costPrice"></div>
        <div class="form-item"><label>成本金额（自动计算，可改）</label><input type="number" min="0" step="0.01" v-model.number="transferForm.amount"></div>
        <div class="form-item"><label>生产日期（自动匹配）</label><input type="text" :value="transferForm.productionDate" disabled></div>
        <div class="form-item"><label>保质期(天)（自动匹配）</label><input type="text" :value="transferForm.shelfLife" disabled></div>
        <div class="form-item"><label>到期时间（自动计算）</label><input type="text" :value="transferForm.expiryDate" disabled></div>
        <div class="form-item"><label>物流费用（计入调配物流费）</label><input type="number" min="0" step="0.01" v-model.number="transferForm.logisticsFee"></div>
        <div class="form-item"><label>调拨时间<b class="req">*</b></label><input type="date" v-model="transferForm.time"></div>
        <div class="form-item full"><label>备注</label><input type="text" v-model="transferForm.remark"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showTransferForm=false">取消</button>
        <button class="btn btn-primary" @click="saveTransfer">保存</button>
      </template>
    </x-modal>

    <!-- 生产组装弹窗 -->
    <x-modal v-if="showProdForm" :title="editingProd?'修改生产单':'新增生产单'" :width="920" :fullscreen="$root.isMobile" position="bottom" @close="showProdForm=false">
      <div style="font-weight:600;margin:4px 0 8px;color:#334155">新商品信息（完成后同步至商品管理）</div>
      <div class="form-grid">
        <div class="form-item"><label>商品名称<b class="req">*</b></label><input type="text" v-model="prodForm.goodsName" placeholder="对应商品管理中的商品名称"></div>
        <div class="form-item"><label>商品类型<b class="req">*</b></label><x-combobox v-model="prodForm.typeId" :options="typeOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>商品单位<b class="req">*</b></label><x-combobox v-model="prodForm.unitId" :options="unitOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>供应商（默认自营）</label><x-combobox v-model="prodForm.supplierId" :options="supplierOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>SKU</label><input type="text" v-model="prodForm.sku"></div>
      </div>

      <div style="font-weight:600;margin:14px 0 8px;color:#334155;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>所需商品清单（原材料）</span>
        <button v-if="canProdEdit" class="btn btn-primary btn-sm" @click="addProdItem">+ 添加原材料</button>
        <span class="muted">原材料总成本 ￥{{fmtMoney(prodFormItemCost)}}</span>
      </div>
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>源仓库</th><th>商品名称</th><th>单位</th><th class="num">数量</th>
          <th class="num">单价</th><th class="num">金额</th><th>批次号</th><th>生产日期</th><th class="num">保质期(天)</th><th>到期时间</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(it,idx) in prodForm.items" :key="idx">
            <td data-label="序号">{{idx+1}}</td>
            <td data-label="源仓库"><x-combobox v-model="it.whId" :options="whPickOpts" style="width:100%" @update:modelValue="$nextTick(()=>onProdItemWh(it))"/></td>
            <td data-label="商品名称"><x-combobox v-model="it.goodsId" :options="prodItemGoodsOpts(it.whId)" style="width:100%" @update:modelValue="$nextTick(()=>onProdItemGoods(it))"/></td>
            <td data-label="单位">{{S.name('units', it.unitId)}}</td>
            <td data-label="数量"><input type="number" min="1" style="width:70px" v-model.number="it.qty" @change="recalcItem(it)"></td>
            <td data-label="单价"><input type="number" min="0" step="0.01" style="width:80px" v-model.number="it.price" @change="recalcItem(it)"></td>
            <td data-label="金额"><input type="number" min="0" step="0.01" style="width:90px" v-model.number="it.amount" @change="it.amount=U.round2(Number(it.amount)||0)"></td>
            <td data-label="批次号"><x-combobox v-model="it.batchNo" :options="prodItemBatchOpts(it)" style="width:100%" @update:modelValue="$nextTick(()=>onProdItemBatch(it))"/></td>
            <td data-label="生产日期">{{it.productionDate||'-'}}</td>
            <td data-label="保质期(天)">{{it.shelfLife||0}}</td>
            <td data-label="到期时间">{{it.expiryDate||'-'}}</td>
            <td data-label="备注"><input type="text" style="width:90px" v-model="it.remark"></td>
            <td class="ops" data-label="操作"><span class="link danger" @click="delProdItem(idx)">删除</span></td>
          </tr>
          <tr v-if="!prodForm.items.length"><td colspan="13" class="empty">请添加所需原材料</td></tr>
        </tbody>
      </table>
      </div>

      <div style="font-weight:600;margin:14px 0 8px;color:#334155">生产核算</div>
      <div class="form-grid">
        <div class="form-item"><label>生产工费</label><input type="number" min="0" step="0.01" v-model.number="prodForm.laborFee"></div>
        <div class="form-item"><label>生产数量<b class="req">*</b></label><input type="number" min="1" v-model.number="prodForm.qty"></div>
        <div class="form-item"><label>成本价（自动核算）</label><input type="text" :value="fmtMoney(prodFormCostPrice)" disabled></div>
        <div class="form-item"><label>金额（自动核算）</label><input type="text" :value="fmtMoney(prodFormAmount)" disabled></div>
        <div class="form-item"><label>零售价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="prodForm.retailPrice"></div>
        <div class="form-item"><label>大客价</label><input type="number" min="0" step="0.01" v-model.number="prodForm.bigPrice"></div>
        <div class="form-item"><label>批发价</label><input type="number" min="0" step="0.01" v-model.number="prodForm.wholesalePrice"></div>
        <div class="form-item"><label>保质期(天)</label><input type="number" min="0" v-model.number="prodForm.shelfLife" placeholder="0=永不过期"></div>
        <div class="form-item"><label>临期提醒(天)</label><input type="number" min="0" v-model.number="prodForm.expireWarn" placeholder="0=不提醒"></div>
        <div class="form-item"><label>入库仓库<b class="req">*</b></label><x-combobox v-model="prodForm.whId" :options="whPickOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>批次号（自动生成）</label><input type="text" v-model="prodForm.batchNo" placeholder="sc-年月日-xxxxx"></div>
        <div class="form-item"><label>生产时间<b class="req">*</b></label><input type="date" v-model="prodForm.time"></div>
        <div class="form-item full"><label>备注</label><input type="text" v-model="prodForm.remark"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showProdForm=false">取消</button>
        <button class="btn btn-primary" @click="saveProd">保存</button>
      </template>
    </x-modal>
  </div>`
};
