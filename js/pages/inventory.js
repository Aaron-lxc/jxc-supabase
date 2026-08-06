/* 库存管理 + 批量盘库 + 报损管理 + 报溢管理（Tab 聚合页） */
window.Pages = window.Pages || {};

Pages['page-inventory'] = {
  data() {
    return {
      tab: 'stock',
      // 库存明细
      q: { whId: '', typeId: '', name: '', supplierId: '', lastInT1: '', lastInT2: '' },
      page: 1, pageSize: 10, showCheck: false, checkRows: [],
      // 报损管理
      lossQ: { orderNo: '', typeId: '', name: '', supplierId: '', whId: '', t1: '', t2: '' },
      lossPage: 1, lossSize: 10, showLossForm: false, editingLoss: null, lossForm: {},
      // 报溢管理
      ovQ: { orderNo: '', typeId: '', name: '', supplierId: '', whId: '', t1: '', t2: '' },
      ovPage: 1, ovSize: 10, showOvForm: false, editingOv: null, ovForm: {}
    };
  },
  computed: {
    S() { return window.S; },
    canLoss() { return P.canView('loss'); },
    canLossEdit() { return P.canEdit('loss'); },
    canOv() { return P.canView('overflow'); },
    canOvEdit() { return P.canEdit('overflow'); },

    /* 通用下拉 */
    whOpts() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    typeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    supplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    orderOpts() { return [{ value: '', label: '全部订单号' }].concat(S.db.purchases.map(p => ({ value: p.no, label: p.no }))); },
    payMethodOpts() { return [{ value: '', label: '请选择' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m }))); },

    /* ---------- 库存明细 ---------- */
    rows() {
      return S.db.stocks.map(s => {
        const g = S.byId('goods', s.goodsId) || {};
        return {
          id: s.id, rec: s, whId: s.whId, goodsId: s.goodsId,
          whName: S.name('warehouses', s.whId), goodsName: g.name || '',
          typeId: g.typeId, typeName: S.name('goodsTypes', g.typeId),
          sku: g.sku || '', unitName: S.name('units', g.unitId),
          supplierId: g.supplierId, supplierName: S.name('suppliers', g.supplierId),
          qty: s.qty, minStock: g.minStock || 0,
          cost: U.round2(s.qty * (g.purchasePrice || 0)),
          value: U.round2(s.qty * (g.retailPrice || 0)),
          lastInTime: s.lastInTime || '-', lastCheckTime: s.lastCheckTime || '-'
        };
      }).filter(r =>
        (!this.q.whId || r.whId === this.q.whId) &&
        (!this.q.typeId || r.typeId === this.q.typeId) &&
        U.kw(r.goodsName, this.q.name) &&
        (!this.q.supplierId || r.supplierId === this.q.supplierId) &&
        U.inRange(r.lastInTime, this.q.lastInT1, this.q.lastInT2)
      ).sort((a, b) => a.whName.localeCompare(b.whName) || a.goodsName.localeCompare(b.goodsName));
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
      this.checkRows = this.rows.map(r => ({
        rec: r.rec, whName: r.whName, goodsName: r.goodsName, sku: r.sku,
        unitName: r.unitName, qty: r.qty, actual: r.qty
      }));
      this.showCheck = true;
    },
    submitCheck() {
      let changed = 0;
      const t = U.now();
      this.checkRows.forEach(cr => {
        const actual = Number(cr.actual);
        if (isNaN(actual) || actual < 0) return;
        if (actual !== cr.rec.qty) {
          S.db.stockChecks.push({
            id: S.genId(), whId: cr.rec.whId, goodsId: cr.rec.goodsId,
            before: cr.rec.qty, after: actual, diff: actual - cr.rec.qty, time: t
          });
          cr.rec.qty = actual;
          changed++;
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
        '当前库存': r.qty, '最低库存': r.minStock, '库存成本': r.cost, '库存价值': r.value,
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
    }
  },
  template: `
  <div>
    <div class="page-title">库存管理</div>
    <div class="tabs">
      <div class="tab" :class="{active:tab==='stock'}" @click="tab='stock'">库存明细</div>
      <div class="tab" v-if="canLoss" :class="{active:tab==='loss'}" @click="tab='loss'">报损管理</div>
      <div class="tab" v-if="canOv" :class="{active:tab==='overflow'}" @click="tab='overflow'">报溢管理</div>
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
          <th class="num">当前库存</th><th class="num">最低库存</th><th class="num">库存成本</th><th class="num">库存价值</th>
          <th>最后入库时间</th><th>最近盘库时间</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged" :key="r.id">
            <td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="仓库名称">{{r.whName}}</td><td data-label="商品名称">{{r.goodsName}}</td><td data-label="商品类型">{{r.typeName}}</td>
            <td data-label="SKU">{{r.sku}}</td><td data-label="单位">{{r.unitName}}</td><td data-label="供应商">{{r.supplierName}}</td>
            <td class="num" :class="{red: r.qty < r.minStock}" data-label="当前库存"><b>{{r.qty}}</b>
              <span v-if="r.qty < r.minStock" class="tag tag-red">低于下限</span></td>
            <td class="num" data-label="最低库存">{{r.minStock}}</td>
            <td class="num money" data-label="库存成本">{{fmtMoney(r.cost)}}</td><td class="num money" data-label="库存价值">{{fmtMoney(r.value)}}</td>
            <td data-label="最后入库时间">{{r.lastInTime}}</td><td data-label="最近盘库时间">{{r.lastCheckTime}}</td>
          </tr>
          <tr v-if="!paged.length"><td colspan="13" class="empty">暂无库存记录（采购入库后自动生成）</td></tr>
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

    <!-- 批量盘库弹窗 -->
    <x-modal v-if="showCheck" title="批量盘库（修改实际库存后提交，差异自动留痕）" :width="720" :fullscreen="$root.isMobile" position="bottom" @close="showCheck=false">
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr><th>仓库</th><th>商品</th><th>SKU</th><th>单位</th><th class="num">账面库存</th><th class="num" style="width:110px">实际库存</th><th class="num">差异</th></tr></thead>
        <tbody>
          <tr v-for="cr in checkRows">
            <td data-label="仓库">{{cr.whName}}</td>
            <td data-label="商品">{{cr.goodsName}}</td>
            <td data-label="SKU">{{cr.sku}}</td>
            <td data-label="单位">{{cr.unitName}}</td>
            <td class="num" data-label="账面库存">{{cr.qty}}</td>
            <td class="num" data-label="实际库存"><input type="number" min="0" style="width:90px" v-model.number="cr.actual"></td>
            <td class="num" data-label="差异" :class="{red: cr.actual-cr.qty<0, 'green-t': cr.actual-cr.qty>0}">{{(cr.actual||0)-cr.qty}}</td>
          </tr>
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
  </div>`
};
