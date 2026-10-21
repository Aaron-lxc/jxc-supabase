/* 采购管理：保存即入库；一张采购单可含多件明细（表头+明细行，类销售单） */
window.Pages = window.Pages || {};

Pages['page-purchase'] = {
  data() {
    return {
      q: { typeId: '', name: '', supplierId: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, expanded: null,
      form: this.blankForm()
    };
  },
  computed: {
    S() { return window.S; },
    qTypeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    qSupplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    formWhOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('warehouses').map(w => ({ value: w.id, label: w.name }))); },
    payMethodOpts() { return [{ value: '', label: '请选择' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m }))); },
    itemGoodsOpts() { return S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })); },
    formTotal() { return U.round2(this.form.items.reduce((a, it) => a + this.itemAmount(it), 0)); },
    rows() {
      return S.db.purchases.filter(p => {
        const items = p.items || [];
        if (this.q.typeId && !items.some(it => it.typeId === this.q.typeId)) return false;
        if (this.q.name && !items.some(it => U.kw(S.name('goods', it.goodsId), this.q.name))) return false;
        if (this.q.supplierId) {
          const hit = (p.supplierId === this.q.supplierId) || items.some(it => it.supplierId === this.q.supplierId);
          if (!hit) return false;
        }
        if (!U.inRange(p.inTime, this.q.d1, this.q.d2)) return false;
        return true;
      }).slice().sort((a, b) => (b.inTime || '').localeCompare(a.inTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    blankForm() { return { whId: '', payMethod: '', remark: '', items: [this.blankItem()] }; },
    blankItem() { return { goodsId: '', qty: null, price: null, productionDate: '', batchNo: '' }; },
    openNew() { this.editing = null; this.form = this.blankForm(); this.showForm = true; },
    openEdit(p) {
      this.editing = p;
      this.form = {
        whId: p.whId, payMethod: p.payMethod || '', remark: p.remark || '',
        items: (p.items || []).map(it => ({ goodsId: it.goodsId, qty: it.qty, price: it.price, productionDate: it.productionDate || '', batchNo: it.batchNo || '' }))
      };
      this.showForm = true;
    },
    addItem() { this.form.items.push(this.blankItem()); },
    rmItem(i) { this.form.items.splice(i, 1); if (!this.form.items.length) this.addItem(); },
    onGoodsChange(it) {
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      if (g && (it.price == null || it.price === '')) it.price = g.purchasePrice;
    },
    itemAmount(it) { return U.round2((Number(it.qty) || 0) * (Number(it.price) || 0)); },
    stockOf(it) { if (!this.form.whId || !it.goodsId) return ''; return S.stockQty(this.form.whId, it.goodsId); },
    save() {
      const f = this.form;
      if (!f.whId) return alert('请选择入库仓库');
      const items = [];
      for (const it of f.items) {
        if (!it.goodsId) return alert('存在未选择商品的明细行');
        if (!it.qty || it.qty <= 0) return alert('采购数量必须大于 0');
        if (it.price == null || it.price < 0) return alert('采购价不能为负');
        items.push({ goodsId: it.goodsId, qty: Number(it.qty), price: Number(it.price), productionDate: it.productionDate || '', batchNo: it.batchNo || '' });
      }
      if (!items.length) return alert('请至少添加一项采购明细');
      if (this.editing) {
        const err = S.updatePurchase(this.editing.id, { whId: f.whId, payMethod: f.payMethod || '', remark: f.remark || '', items });
        if (err) return alert(err);
      } else {
        const r = S.addPurchase({ whId: f.whId, payMethod: f.payMethod || '', remark: f.remark || '', items });
        if (typeof r === 'string') return alert(r);
      }
      this.showForm = false; this.editing = null; this.expanded = null;
    },
    del(p) {
      if (!U.confirm('删除采购单将回滚对应库存（共 ' + (p.items || []).length + ' 项明细），确定删除吗？')) return;
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
          <th></th><th>序号</th><th>订单号</th><th>供应商</th><th>仓库</th><th>明细</th>
          <th class="num">采购费用合计</th><th>支付方式</th><th>入库时间</th><th>操作</th>
        </tr></thead>
        <tbody>
          <template v-for="(p,i) in paged" :key="p.id">
            <tr :class="{expanded: expanded===p.id}" @click="expanded = expanded===p.id ? null : p.id">
              <td class="exp"><span class="caret" :class="{open: expanded===p.id}">▸</span></td>
              <td data-label="序号">{{(page-1)*pageSize+i+1}}</td>
              <td data-label="订单号">{{p.no}}</td>
              <td data-label="供应商">{{S.name('suppliers', p.supplierId) || (p.items&&p.items[0]? S.name('suppliers', p.items[0].supplierId) : '—')}}</td>
              <td data-label="仓库">{{S.name('warehouses', p.whId)}}</td>
              <td data-label="明细">{{(p.items||[]).length}} 项</td>
              <td class="num money" data-label="采购费用合计">{{fmtMoney(p.amount)}}</td>
              <td data-label="支付方式">{{p.payMethod||'—'}}</td>
              <td data-label="入库时间">{{p.inTime}}</td>
              <td class="ops" data-label="操作" @click.stop>
                <span class="link" @click="openEdit(p)">修改</span>
                <span class="link danger" @click="del(p)">删除</span>
              </td>
            </tr>
            <tr v-if="expanded===p.id" class="detail-row">
              <td colspan="10">
                <table class="grid sub">
                  <thead><tr><th>商品</th><th>供应商</th><th>单位</th><th class="num">数量</th><th class="num">采购价</th><th class="num">金额</th><th>生产日期</th><th>批次号</th></tr></thead>
                  <tbody>
                    <tr v-for="(it,idx) in (p.items||[])" :key="idx">
                      <td>{{S.name('goods', it.goodsId)}}</td>
                      <td>{{S.name('suppliers', it.supplierId)}}</td>
                      <td>{{S.name('units', it.unitId)}}</td>
                      <td class="num">{{it.qty}}</td>
                      <td class="num money">{{fmtMoney(it.price)}}</td>
                      <td class="num money">{{fmtMoney(it.amount)}}</td>
                      <td>{{it.productionDate||'—'}}</td>
                      <td>{{it.batchNo || p.no}}</td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </template>
          <tr v-if="!paged.length"><td colspan="10" class="empty">暂无数据</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <x-modal v-if="showForm" :title="editing?'修改采购单':'新增采购单（保存后自动入库）'" :width="860" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>入库仓库<b class="req">*</b></label>
          <x-combobox v-model="form.whId" :options="formWhOpts" style="width:100%"/></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" style="width:100%"/></div>
        <div class="form-item full"><label>备注</label>
          <input type="text" v-model="form.remark" placeholder="选填，本采购单备注"></div>
      </div>
      <div class="section-title" style="margin-top:12px">采购明细</div>
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr><th style="min-width:180px">商品名称</th><th>供应商</th><th>单位</th><th class="num">可用库存</th><th style="width:90px">数量</th><th style="width:100px">采购价</th><th class="num">金额</th><th>生产日期</th><th>批次号</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-for="(it,i) in form.items" :key="i">
            <td data-label="商品名称"><x-combobox v-model="it.goodsId" :options="itemGoodsOpts" placeholder="请选择（可输入检索）" @update:modelValue="$nextTick(()=>onGoodsChange(it))"/></td>
            <td data-label="供应商">{{it.goodsId ? S.name('suppliers', S.byId('goods', it.goodsId) ? S.byId('goods', it.goodsId).supplierId : '') : '—'}}</td>
            <td data-label="单位">{{it.goodsId ? S.name('units', S.byId('goods', it.goodsId) ? S.byId('goods', it.goodsId).unitId : '') : '—'}}</td>
            <td class="num" data-label="可用库存">{{stockOf(it)}}</td>
            <td data-label="数量"><input type="number" min="1" style="width:80px" v-model.number="it.qty"></td>
            <td data-label="采购价"><input type="number" min="0" step="0.01" style="width:90px" v-model.number="it.price"></td>
            <td class="num money" data-label="金额">{{fmtMoney(itemAmount(it))}}</td>
            <td data-label="生产日期"><input type="date" v-model="it.productionDate"></td>
            <td data-label="批次号"><input type="text" v-model="it.batchNo" placeholder="留空=采购单号"></td>
            <td data-label="操作"><span class="link danger" @click="rmItem(i)">删</span></td>
          </tr>
        </tbody>
      </table>
      </div>
      <div style="margin-top:8px"><button class="btn btn-sm" @click="addItem">+ 添加明细行</button></div>
      <div class="total-bar">采购费用合计：<b class="money">￥{{fmtMoney(formTotal)}}</b></div>
      <div class="form-hint">入库时间自动记录为保存时刻（年月日时分秒），订单号自动生成（PO-年月日-xxxxx）。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存并入库</button>
      </template>
    </x-modal>
  </div>`
};
