/* 采购管理：保存即入库 */
window.Pages = window.Pages || {};

Pages['page-purchase'] = {
  data() {
    return {
      q: { typeId: '', name: '', supplierId: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null,
      form: { typeId: '', goodsId: '', qty: null, price: null, whId: '', payMethod: '', productionDate: '', batchNo: '' }
    };
  },
  computed: {
    S() { return window.S; },
    qTypeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    qSupplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    formTypeOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('goodsTypes').map(t => ({ value: t.id, label: t.name }))); },
    formGoodsOpts() { return [{ value: '', label: '请选择' }].concat(this.formGoods.map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name }))); },
    formWhOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('warehouses').map(w => ({ value: w.id, label: w.name }))); },
    payMethodOpts() {
      return [{ value: '', label: '请选择' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m })));
    },
    rows() {
      return S.db.purchases.filter(p =>
        (!this.q.typeId || p.typeId === this.q.typeId) &&
        U.kw(S.name('goods', p.goodsId), this.q.name) &&
        (!this.q.supplierId || p.supplierId === this.q.supplierId) &&
        U.inRange(p.inTime, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.inTime || '').localeCompare(a.inTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    formGoods() { /* 按类型联动商品 */
      return S.enabled('goods').filter(g => !this.form.typeId || g.typeId === this.form.typeId);
    },
    selGoods() { return this.form.goodsId ? S.byId('goods', this.form.goodsId) : null; },
    formAmount() {
      return U.round2((Number(this.form.qty) || 0) * (Number(this.form.price) || 0));
    }
  },
  watch: {
    'form.typeId'() { if (this.editing) return; this.form.goodsId = ''; this.form.price = null; },
    'form.goodsId'(v) {
      if (this.editing) return;
      const g = v ? S.byId('goods', v) : null;
      this.form.price = g ? g.purchasePrice : null;
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    rowFields(p) {
      return [
        { label: '订单号', value: p.no },
        { label: '商品类型', value: S.name('goodsTypes', p.typeId) },
        { label: '商品名称', value: S.name('goods', p.goodsId) },
        { label: '供应商', value: S.name('suppliers', p.supplierId) },
        { label: '单位', value: S.name('units', p.unitId) },
        { label: '采购数量', value: p.qty },
        { label: '采购价', value: U.fmtMoney(p.price) },
        { label: '金额', value: U.fmtMoney(p.amount) },
        { label: '入库仓库', value: S.name('warehouses', p.whId) },
        { label: '支付方式', value: p.payMethod || '—' },
        { label: '入库时间', value: p.inTime },
        { label: '生产日期', value: p.productionDate || '—' },
        { label: '批次号', value: p.batchNo || '—' }
      ];
    },
    openNew() {
      this.editing = null;
      this.form = { typeId: '', goodsId: '', qty: null, price: null, whId: '', payMethod: '', productionDate: '', batchNo: '' };
      this.showForm = true;
    },
    openEdit(p) {
      this.editing = p;
      this.form = { typeId: p.typeId, goodsId: p.goodsId, qty: p.qty, price: p.price, whId: p.whId, payMethod: p.payMethod || '', productionDate: p.productionDate || '', batchNo: p.batchNo || '' };
      this.showForm = true;
    },
    save() {
      const f = this.form;
      if (!f.goodsId) return alert('请选择商品');
      if (!f.qty || f.qty <= 0) return alert('请填写采购数量');
      if (f.price == null || f.price < 0) return alert('请填写采购价');
      if (!f.whId) return alert('请选择入库仓库');
      const g = S.byId('goods', f.goodsId);
      if (this.editing) {
        const err = S.updatePurchase(this.editing.id, {
          goodsId: g.id, qty: f.qty, price: f.price, whId: f.whId, payMethod: f.payMethod || '',
          productionDate: f.productionDate || null, batchNo: f.batchNo || ''
        });
        if (err) return alert(err);
      } else {
        S.addPurchase({
          typeId: g.typeId, goodsId: g.id, supplierId: g.supplierId, unitId: g.unitId,
          qty: Number(f.qty), price: Number(f.price), whId: f.whId, payMethod: f.payMethod || '',
          productionDate: f.productionDate || null, batchNo: f.batchNo || ''
        });
      }
      this.showForm = false;
      this.editing = null;
    },
    del(p) {
      if (!U.confirm('删除采购单将回滚对应库存（' + S.name('goods', p.goodsId) + ' × ' + p.qty + '），确定删除吗？')) return;
      const err = S.deletePurchase(p.id);
      if (err) alert(err);
    }
  },
  template: `
  <div>
    <div class="page-title">采购管理</div>
    <div class="card">
      <div class="toolbar">
        <x-combobox v-model="q.typeId" :options="qTypeOpts" style="width:140px"/>
        <input type="text" v-model="q.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="q.supplierId" :options="qSupplierOpts" style="width:150px"/>
        <label>入库时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
        <div class="spacer"></div>
        <button class="btn btn-primary" @click="openNew">+ 新增采购单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>订单号</th><th>商品类型</th><th>商品名称</th><th>供应商</th><th>单位</th>
          <th class="num">采购数量</th><th class="num">采购价</th><th class="num">金额</th><th>入库仓库</th><th>支付方式</th><th>入库时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(p,i) in paged" :key="p.id">
            <td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="订单号">{{p.no}}</td>
            <td data-label="商品类型">{{S.name('goodsTypes',p.typeId)}}</td><td data-label="商品名称">{{S.name('goods',p.goodsId)}}</td>
            <td data-label="供应商">{{S.name('suppliers',p.supplierId)}}</td><td data-label="单位">{{S.name('units',p.unitId)}}</td>
            <td class="num" data-label="采购数量">{{p.qty}}</td><td class="num money" data-label="采购价">{{fmtMoney(p.price)}}</td>
            <td class="num money" data-label="金额">{{fmtMoney(p.amount)}}</td>
            <td data-label="入库仓库">{{S.name('warehouses',p.whId)}}</td><td data-label="支付方式">{{p.payMethod||'—'}}</td><td data-label="入库时间">{{p.inTime}}</td>
            <td class="ops" data-label="操作">
              <span class="link" @click="openEdit(p)">修改</span>
              <span class="link danger" @click="del(p)">删除</span>
            </td>
          </tr>
          <tr v-if="!paged.length"><td colspan="13" class="empty">暂无数据</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <x-modal v-if="showForm" :title="editing?'修改采购单':'新增采购单（保存后自动入库）'" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>商品类型<b class="req">*</b></label>
          <x-combobox v-model="form.typeId" :options="formTypeOpts" style="width:100%"/></div>
        <div class="form-item"><label>商品名称<b class="req">*</b></label>
          <x-combobox v-model="form.goodsId" :options="formGoodsOpts" style="width:100%"/></div>
        <div class="form-item"><label>供应商（自动匹配）</label><input type="text" :value="selGoods ? S.name('suppliers',selGoods.supplierId) : ''" disabled></div>
        <div class="form-item"><label>商品单位（自动匹配）</label><input type="text" :value="selGoods ? S.name('units',selGoods.unitId) : ''" disabled></div>
        <div class="form-item"><label>采购数量<b class="req">*</b></label><input type="number" min="1" v-model.number="form.qty"></div>
        <div class="form-item"><label>采购价（自动匹配，可编辑）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.price"></div>
        <div class="form-item"><label>金额（自动计算）</label><input type="text" :value="fmtMoney(formAmount)" disabled></div>
        <div class="form-item"><label>入库仓库<b class="req">*</b></label>
          <x-combobox v-model="form.whId" :options="formWhOpts" style="width:100%"/></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" style="width:100%"/></div>
        <div class="form-item"><label>生产日期</label><input type="date" v-model="form.productionDate"></div>
        <div class="form-item"><label>批次号</label><input type="text" v-model="form.batchNo" placeholder="留空=采购单号"></div>
      </div>
      <div class="form-hint" style="margin-top:8px">入库时间自动记录为保存时刻（年月日时分秒），订单号自动生成（PO-年月日-xxxxx）。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存并入库</button>
      </template>
    </x-modal>
  </div>`
};
