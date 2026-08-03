/* 销售管理：销售管理 / 退货管理 / 结算管理 */
window.Pages = window.Pages || {};

const PRICE_FIELD = { '零售价': 'retailPrice', '大客价': 'bigPrice', '批发价': 'wholePrice' };

/* 销售单打印模版默认配置（可在「模版设置」中勾选） */
const DEFAULT_TPL = {
  title: '销售单',
  head: { company: true, no: true, customer: true, custPhone: false, custAddress: false, wh: true, createTime: true, finishTime: false, status: true },
  cols: { sku: true, unit: true, priceType: true, price: true, amount: true },
  foot: { total: true, returned: false, net: false, arrears: true, due: false, maker: true, deliver: true, sign: true, remark: false, tax: true, taxPayable: true, delivery: true }
};
const TPL_LABELS = {
  head: { company: '公司名称抬头', no: '销售单号', customer: '客户名称', custPhone: '客户联系电话', custAddress: '客户地址', wh: '发货仓库', createTime: '下单时间', finishTime: '完成时间', status: '单据状态' },
  cols: { sku: 'SKU', unit: '单位', priceType: '价格类型', price: '单价', amount: '金额' },
  foot: { total: '本单合计', returned: '已退货金额', net: '本单净额', arrears: '客户累计欠款', due: '应付日期', maker: '制单人签名栏', deliver: '送货人签名栏', sign: '客户签收栏', remark: '客户备注', tax: '税点费用', taxPayable: '含税应付合计', delivery: '配送费' }
};

/* ---------------- 销售单 ---------------- */
const SaleList = {
  data() {
    return {
      q: { cust: '', whId: '', goods: '', supplierId: '', status: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: null, detail: null,
      showTpl: false, tplDraft: null, preview: null, tplLabels: TPL_LABELS
    };
  },
  computed: {
    S() { return window.S; },
    tpl() {
      const t = S.db.settings.saleTemplate || {};
      return {
        title: t.title || DEFAULT_TPL.title,
        head: Object.assign({}, DEFAULT_TPL.head, t.head || {}),
        cols: Object.assign({}, DEFAULT_TPL.cols, t.cols || {}),
        foot: Object.assign({}, DEFAULT_TPL.foot, t.foot || {})
      };
    },
    custOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('customers').map(c => ({ value: c.id, label: c.name }))); },
    whOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('warehouses').map(w => ({ value: w.id, label: w.name }))); },
    whOptsAll() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    supplierOptsAll() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(t => ({ value: t.id, label: t.name }))); },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未完成', label: '未完成' }, { value: '已完成', label: '已完成' }]; },
    priceTypeOpts() { return ['零售价', '大客价', '批发价'].map(x => ({ value: x, label: x })); },
    whGoodsOpts() { return [{ value: '', label: '请选择' }].concat(this.whGoods.map(g => ({ value: g.id, label: g.name }))); },
    /* 新增/修改时自动匹配的客户累计欠款 */
    formArrears() { return this.form && this.form.customerId ? S.custArrears(this.form.customerId) : 0; },
    rows() {
      return S.db.sales.filter(s =>
        U.kw(S.name('customers', s.customerId), this.q.cust) &&
        (!this.q.whId || s.whId === this.q.whId) &&
        (!this.q.goods || (s.items || []).some(it => U.kw(S.name('goods', it.goodsId), this.q.goods))) &&
        (!this.q.supplierId || (s.items || []).some(it => { const g = S.byId('goods', it.goodsId); return g && g.supplierId === this.q.supplierId; })) &&
        (!this.q.status || s.status === this.q.status) &&
        U.inRange(s.createTime, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    /* 表单可选商品：该仓库有库存记录的商品 */
    whGoods() {
      if (!this.form || !this.form.whId) return [];
      const ids = S.db.stocks.filter(s => s.whId === this.form.whId && s.qty > 0).map(s => s.goodsId);
      return S.enabled('goods').filter(g => ids.includes(g.id));
    },
    formCust() { return this.form && this.form.customerId ? S.byId('customers', this.form.customerId) : null; },
    formTotal() {
      if (!this.form) return 0;
      return U.round2(this.form.items.reduce((a, it) => a + (Number(it.qty) || 0) * (Number(it.price) || 0), 0));
    },
    exemptOpts() { return [{ value: '否', label: '否' }, { value: '是', label: '是' }]; },
    /* 表单实时预览：税点费用（仅减免=否 且 税点>0 时计）与含税应付合计 */
    formTaxCost() {
      if (!this.form) return 0;
      const rate = Number(this.form.taxRate || 0);
      const exempt = this.form.taxExempt || '否';
      if (!rate || exempt === '是') return 0;
      return U.round2(this.formTotal * rate / 100);
    },
    formPayable() { return U.round2(this.formTotal + this.formTaxCost); },
    /* 本单税点是否偏离客户档案（即手工特调），用于表单实时提示 */
    formTaxManual() {
      const c = this.formCust;
      if (!c) return false;
      return Number(this.form.taxRate || 0) !== Number(c.taxRate || 0)
        || (this.form.taxExempt || '否') !== (c.taxExempt || '否');
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    itemsSummary(s) {
      const its = s.items || [];
      if (!its.length) return '-';
      const first = S.name('goods', its[0].goodsId);
      return its.length > 1 ? `${first} 等 ${its.length} 种` : first;
    },
    qtySum(s) { return S.saleQty(s); },
    openNew() {
      this.editing = null;
      this.form = { customerId: '', whId: '', taxRate: 0, taxExempt: '否', deliveryFee: null, items: [this.blankItem()] };
      this.showForm = true;
    },
    openEdit(s) {
      if (s.status === '已完成') return alert('已完成的销售单不能修改，如需调整请先退货');
      this.editing = s;
      this.form = { customerId: s.customerId, whId: s.whId, taxRate: s.taxRate || 0, taxExempt: s.taxExempt || '否', deliveryFee: s.deliveryFee || 0, items: s.items.map(it => ({ ...it })) };
      this.showForm = true;
    },
    /* 选定客户后自动带出该客户的税点/减免（可在单据上临时覆盖） */
    onCustChange(v) {
      const c = v ? S.byId('customers', v) : null;
      if (c) { this.form.taxRate = c.taxRate || 0; this.form.taxExempt = c.taxExempt || '否'; }
    },
    blankItem() { return { goodsId: '', sku: '', qty: null, unitId: '', priceType: '零售价', price: null, amount: 0 }; },
    addItem() { this.form.items.push(this.blankItem()); },
    rmItem(i) { this.form.items.splice(i, 1); if (!this.form.items.length) this.addItem(); },
    onGoodsChange(it) {
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      if (g) { it.sku = g.sku; it.unitId = g.unitId; it.price = g[PRICE_FIELD[it.priceType]]; }
      else { it.sku = ''; it.unitId = ''; it.price = null; }
    },
    onPriceTypeChange(it) {
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      if (g) it.price = g[PRICE_FIELD[it.priceType]];
    },
    stockOf(it) { return this.form.whId && it.goodsId ? S.stockQty(this.form.whId, it.goodsId) : ''; },
    save() {
      const f = this.form;
      if (!f.customerId) return alert('请选择客户');
      if (!f.whId) return alert('请选择仓库');
      const items = f.items.filter(it => it.goodsId && Number(it.qty) > 0);
      if (!items.length) return alert('请至少添加一行有效的商品明细');
      for (const it of items) {
        if (it.price == null || it.price < 0) return alert('请填写销售价格');
        it.qty = Number(it.qty); it.price = Number(it.price);
        it.amount = U.round2(it.qty * it.price);
      }
      const cust = S.byId('customers', f.customerId);
      const total = U.round2(items.reduce((a, it) => a + it.amount, 0));
      /* 累计欠款：自动匹配该客户当前累计欠款（含税应付口径）并留存快照；税点按本单填写值（默认带出客户值）保存 */
      const arrears = S.custArrears(f.customerId);
      const taxRate = Number(f.taxRate || 0), taxExempt = f.taxExempt || '否';
      /* 手工特调标记：本单税点与客户档案当前值不一致即视为特调，
         此后客户档案调整税点时本单不再自动跟随；改回与客户一致则自动恢复跟随 */
      const cRate = cust ? Number(cust.taxRate || 0) : 0;
      const cExempt = cust ? (cust.taxExempt || '否') : '否';
      const taxManual = (taxRate !== cRate || taxExempt !== cExempt);
      if (this.editing) {
        Object.assign(this.editing, {
          customerId: f.customerId, whId: f.whId, items, total, custRemark: cust ? cust.remark : '',
          arrearsSnap: arrears, taxRate, taxExempt, taxManual, deliveryFee: U.round2(Number(f.deliveryFee) || 0)
        });
      } else {
        S.db.sales.push({
          id: S.genId(), no: S.genNo('SO'), customerId: f.customerId, whId: f.whId,
          items, total, custRemark: cust ? cust.remark : '', arrearsSnap: arrears,
          taxRate, taxExempt, taxManual, deliveryFee: U.round2(Number(f.deliveryFee) || 0),
          status: '未完成', payStatus: '', payTime: '', createTime: U.now(), finishTime: ''
        });
      }
      this.showForm = false;
    },
    custArrears(s) { return S.custArrears(s.customerId); },
    del(s) {
      if (s.status === '已完成') return alert('已完成的销售单不能删除（已扣减库存并计入统计）');
      if (!U.confirm('确定删除销售单 ' + s.no + ' 吗？')) return;
      S.db.sales = S.db.sales.filter(x => x.id !== s.id);
    },
    finish(s) {
      if (s.status === '已完成') return;
      if (!U.confirm('完成销售单将扣减库存并计入销售统计，确定完成吗？')) return;
      const err = S.finishSale(s);
      if (err) alert(err);
    },
    /* 按模版设置生成销售单 HTML，打印与预览共用 */
    buildHTML(s) {
      const t = this.tpl, cust = S.byId('customers', s.customerId) || {};
      const H = [];
      H.push(`<h2>${t.head.company ? (S.db.settings.company || '') + ' ' : ''}${t.title}</h2>`);
      if (t.head.no) H.push(`<div class="p-sub">单号：${s.no}</div>`);
      const info = [];
      if (t.head.customer) info.push(`<span>客户名称：${cust.name || ''}</span>`);
      if (t.head.custPhone) info.push(`<span>联系电话：${cust.phone || '-'}</span>`);
      if (t.head.custAddress) info.push(`<span>客户地址：${cust.address || '-'}</span>`);
      if (t.head.wh) info.push(`<span>发货仓库：${S.name('warehouses', s.whId)}</span>`);
      if (t.head.createTime) info.push(`<span>下单时间：${s.createTime}</span>`);
      if (t.head.finishTime) info.push(`<span>完成时间：${s.finishTime || '-'}</span>`);
      if (t.head.status) info.push(`<span>单据状态：${s.status}${s.payStatus ? ' / ' + s.payStatus : ''}</span>`);
      if (info.length) H.push(`<div class="p-info">${info.join('')}</div>`);

      const th = ['<th>序号</th>', '<th>商品名称</th>'];
      if (t.cols.sku) th.push('<th>SKU</th>');
      th.push('<th>数量</th>');
      if (t.cols.unit) th.push('<th>单位</th>');
      if (t.cols.priceType) th.push('<th>价格类型</th>');
      if (t.cols.price) th.push('<th>单价</th>');
      if (t.cols.amount) th.push('<th>金额</th>');
      const body = (s.items || []).map((it, i) => {
        const td = [`<td>${i + 1}</td>`, `<td>${S.name('goods', it.goodsId)}</td>`];
        if (t.cols.sku) td.push(`<td>${it.sku || ''}</td>`);
        td.push(`<td>${it.qty}</td>`);
        if (t.cols.unit) td.push(`<td>${S.name('units', it.unitId)}</td>`);
        if (t.cols.priceType) td.push(`<td>${it.priceType || ''}</td>`);
        if (t.cols.price) td.push(`<td>${U.fmtMoney(it.price)}</td>`);
        if (t.cols.amount) td.push(`<td>${U.fmtMoney(it.amount)}</td>`);
        return `<tr>${td.join('')}</tr>`;
      }).join('');
      let tfoot = '';
      if (t.foot.total) tfoot = `<tfoot><tr><td colspan="${th.length - 1}" style="text-align:right"><b>本单合计</b></td><td><b>￥${U.fmtMoney(s.total)}</b></td></tr></tfoot>`;
      H.push(`<table><thead><tr>${th.join('')}</tr></thead><tbody>${body}</tbody>${tfoot}</table>`);

      const f2 = [];
      if (t.foot.returned) f2.push(`<span>已退货金额：￥${U.fmtMoney(S.saleReturnedAmt(s.id))}</span>`);
      if (t.foot.net) f2.push(`<span>本单净额：￥${U.fmtMoney(S.saleNet(s))}</span>`);
      if (t.foot.due) f2.push(`<span>应付日期：${S.saleDueDate(s)}</span>`);
      if (t.foot.arrears) f2.push(`<span><b>客户累计欠款（含税应付）：￥${U.fmtMoney(S.custArrears(s.customerId))}</b></span>`);
      if (t.foot.tax) f2.push(`<span>税点费用（${s.taxRate || 0}%）：￥${U.fmtMoney(S.saleTaxCost(s))}</span>`);
      if (t.foot.taxPayable) f2.push(`<span><b>含税应付合计：￥${U.fmtMoney(S.salePayable(s))}</b></span>`);
      if (t.foot.delivery) f2.push(`<span>配送费（不计入应收，计入成本）：￥${U.fmtMoney(S.saleDeliveryCost(s))}</span>`);
      if (t.foot.remark && s.custRemark) f2.push(`<span>客户备注：${s.custRemark}</span>`);
      if (f2.length) H.push(`<div class="p-info">${f2.join('')}</div>`);

      const sign = [];
      if (t.foot.maker) sign.push('<span>制单人：__________</span>');
      if (t.foot.deliver) sign.push('<span>送货人：__________</span>');
      if (t.foot.sign) sign.push('<span>客户签收：__________</span>');
      if (sign.length) H.push(`<div class="p-foot">${sign.join('')}</div>`);
      return H.join('\n');
    },
    print(s) { U.printHTML(this.buildHTML(s)); },
    openPreview(s) { this.preview = s; },
    printPreview() { const s = this.preview; this.preview = null; this.print(s); },
    /* 模版设置 */
    openTpl() { this.tplDraft = JSON.parse(JSON.stringify(this.tpl)); this.showTpl = true; },
    saveTpl() { S.db.settings.saleTemplate = JSON.parse(JSON.stringify(this.tplDraft)); this.showTpl = false; },
    resetTpl() { this.tplDraft = JSON.parse(JSON.stringify(DEFAULT_TPL)); }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.cust" placeholder="客户名称模糊查询" style="width:130px">
      <x-combobox v-model="q.whId" :options="whOptsAll" placeholder="全部仓库"/>
      <input type="text" v-model="q.goods" placeholder="商品名称" style="width:110px">
      <x-combobox v-model="q.supplierId" :options="supplierOptsAll" placeholder="全部供应商"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="全部状态"/>
      <input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <button class="btn" @click="openTpl">销售单模版设置</button>
      <button class="btn btn-primary" @click="openNew">+ 新增销售单</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>销售单号</th><th>客户名称</th><th>仓库名称</th><th>商品</th>
        <th class="num">数量</th><th class="num">金额</th><th class="num">税点费用</th><th class="num">累计欠款</th><th class="num">配送费</th><th>客户备注</th><th>状态</th><th>创建时间</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(s,i) in paged" :key="s.id">
          <td>{{(page-1)*pageSize+i+1}}</td><td>{{s.no}}</td>
          <td>{{S.name('customers',s.customerId)}}</td><td>{{S.name('warehouses',s.whId)}}</td>
          <td><span class="link" @click="detail=s">{{itemsSummary(s)}}</span></td>
          <td class="num">{{qtySum(s)}}</td><td class="num money">{{fmtMoney(s.total)}}</td>
          <td class="num money" :class="{red:S.saleTaxCost(s)>0}">{{fmtMoney(S.saleTaxCost(s))}}
            <span v-if="s.taxManual===true && s.status!=='已完成'" class="tag tag-orange" title="本单税点为手工特调，不随客户档案税点变更">特调</span></td>
          <td class="num money" :class="{red:custArrears(s)>0}">{{fmtMoney(custArrears(s))}}</td>
          <td class="num money">{{fmtMoney(S.saleDeliveryCost(s))}}</td>
          <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis">{{s.custRemark||'-'}}</td>
          <td><x-status :v="s.status"/></td><td>{{s.createTime}}</td>
          <td class="ops">
            <span class="link" @click="openPreview(s)">预览</span>
            <span class="link" @click="print(s)">打印</span>
            <template v-if="s.status==='未完成'">
              <span class="link" @click="openEdit(s)">修改</span>
              <span class="link danger" @click="del(s)">删除</span>
              <span class="link green" @click="finish(s)">完成</span>
            </template>
            <span v-else class="link" @click="detail=s">详情</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="14" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <!-- 新增/修改销售单 -->
    <x-modal v-if="showForm" :title="editing?'修改销售单':'新增销售单'" :width="860" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>客户名称<b class="req">*</b></label>
          <x-combobox v-model="form.customerId" :options="custOpts" placeholder="请选择（可输入检索）" @update:modelValue="onCustChange"/></div>
        <div class="form-item"><label>仓库名称<b class="req">*</b></label>
          <x-combobox v-model="form.whId" :options="whOpts" placeholder="请选择（可输入检索）"/></div>
        <div class="form-item"><label>累计欠款（自动匹配）</label>
          <div class="ro-field money" :class="{red:formArrears>0}">￥{{fmtMoney(formArrears)}}</div></div>
        <div class="form-item"><label>开票税点%</label>
          <input type="number" min="0" step="0.01" style="width:90px" v-model.number="form.taxRate"></div>
        <div class="form-item"><label>是否减免</label>
          <x-combobox v-model="form.taxExempt" :options="exemptOpts" placeholder="否" style="width:120px"/></div>
        <div class="form-item"><label>配送费</label>
          <input type="number" min="0" step="0.01" style="width:110px" v-model.number="form.deliveryFee" placeholder="0"></div>
        <div class="form-item full" v-if="formCust && formCust.remark"><label>客户备注（自动同步）</label>
          <div class="muted">{{formCust.remark}}</div></div>
      </div>
      <div class="section-title" style="margin-top:12px">商品明细 <span class="muted">（仅显示所选仓库有库存的商品）</span></div>
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr><th style="min-width:180px">商品名称</th><th>SKU</th><th class="num">可用库存</th><th style="width:90px">数量</th><th>单位</th><th style="width:100px">价格类型</th><th style="width:100px">销售价格</th><th class="num">金额</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(it,i) in form.items" :key="i">
            <td><x-combobox v-model="it.goodsId" :options="whGoodsOpts" placeholder="请选择（可输入检索）" @update:modelValue="$nextTick(()=>onGoodsChange(it))"/></td>
            <td>{{it.sku}}</td>
            <td class="num">{{stockOf(it)}}</td>
            <td><input type="number" min="1" style="width:80px" v-model.number="it.qty"></td>
            <td>{{it.unitId ? S.name('units',it.unitId) : ''}}</td>
            <td><x-combobox v-model="it.priceType" :options="priceTypeOpts" @update:modelValue="$nextTick(()=>onPriceTypeChange(it))"/></td>
            <td><input type="number" min="0" step="0.01" style="width:90px" v-model.number="it.price"></td>
            <td class="num money">{{fmtMoney((it.qty||0)*(it.price||0))}}</td>
            <td><span class="link danger" @click="rmItem(i)">删</span></td>
          </tr>
        </tbody>
      </table>
      </div>
      <div style="margin-top:8px"><button class="btn btn-sm" @click="addItem">+ 添加明细行</button></div>
      <div class="total-bar">合计金额（税前商品金额）：<b class="money">￥{{fmtMoney(formTotal)}}</b></div>
      <div class="total-bar sub">税点费用（税点 {{form.taxRate||0}}%）：<b class="money red">￥{{fmtMoney(formTaxCost)}}</b>　｜　含税应付合计：<span style="font-weight:700;color:#0f172a">￥{{fmtMoney(formPayable)}}</span></div>
      <div class="form-hint" v-if="formTaxManual"><span class="tag tag-orange">特调</span> 本单税点已手工调整（客户档案为 {{formCust.taxRate||0}}% / 减免{{formCust.taxExempt||'否'}}），保存后本单不再随客户档案税点变更自动更新；改回与客户一致即恢复自动跟随。</div>
      <div class="form-hint">销售单号自动生成（SO-年月日-xxxxx）；保存后为「未完成」状态，点击「完成」时才扣减库存并计入统计。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <!-- 详情 -->
    <x-modal v-if="detail" :title="'销售单详情 - '+detail.no" :width="680" @close="detail=null">
      <div class="p-info" style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:10px">
        <span>客户：<b>{{S.name('customers',detail.customerId)}}</b></span>
        <span>仓库：{{S.name('warehouses',detail.whId)}}</span>
        <span>状态：<x-status :v="detail.status"/></span>
        <span v-if="detail.payStatus">支付：<x-status :v="detail.payStatus"/></span>
      </div>
      <table class="grid">
        <thead><tr><th>商品</th><th>SKU</th><th class="num">数量</th><th>单位</th><th>价格类型</th><th class="num">单价</th><th class="num">金额</th></tr></thead>
        <tbody>
          <tr v-for="it in detail.items">
            <td>{{S.name('goods',it.goodsId)}}</td><td>{{it.sku}}</td><td class="num">{{it.qty}}</td>
            <td>{{S.name('units',it.unitId)}}</td><td>{{it.priceType}}</td>
            <td class="num money">{{fmtMoney(it.price)}}</td><td class="num money">{{fmtMoney(it.amount)}}</td>
          </tr>
        </tbody>
      </table>
      <div class="total-bar">合计：<b class="money">￥{{fmtMoney(detail.total)}}</b>
        <span v-if="S.saleReturnedAmt(detail.id)>0" class="muted">（已退货 ￥{{fmtMoney(S.saleReturnedAmt(detail.id))}}，净额 ￥{{fmtMoney(S.saleNet(detail))}}）</span>
        <span>税点费用：￥{{fmtMoney(S.saleTaxCost(detail))}}</span>
        <span>含税应付：<b class="money">￥{{fmtMoney(S.salePayable(detail))}}</b></span>
        <span>配送费成本：￥{{fmtMoney(S.saleDeliveryCost(detail))}}</span></div>
      <template #foot>
        <button class="btn" @click="openPreview(detail)">预览</button>
        <button class="btn" @click="print(detail)">打印销售单</button>
        <button class="btn" @click="detail=null">关闭</button>
      </template>
    </x-modal>

    <!-- 打印预览 -->
    <x-modal v-if="preview" :title="'打印预览 - '+preview.no" :width="820" @close="preview=null">
      <div class="print-preview" v-html="buildHTML(preview)"></div>
      <div class="form-hint">以上为按当前模版设置渲染的实际打印效果，确认无误后点击「确认打印」。</div>
      <template #foot>
        <button class="btn" @click="preview=null">取消</button>
        <button class="btn" @click="preview=null; openTpl()">调整模版</button>
        <button class="btn btn-primary" @click="printPreview">确认打印</button>
      </template>
    </x-modal>

    <!-- 销售单模版设置 -->
    <x-modal v-if="showTpl" title="销售单模版设置" :width="720" @close="showTpl=false">
      <div class="form-item"><label>单据标题</label><input type="text" v-model="tplDraft.title" placeholder="销售单"></div>
      <div class="section-title" style="margin-top:12px">表头信息</div>
      <div class="chk-grid">
        <label v-for="(lb,k) in tplLabels.head" :key="'h'+k"><input type="checkbox" v-model="tplDraft.head[k]"> {{lb}}</label>
      </div>
      <div class="section-title" style="margin-top:12px">明细列</div>
      <div class="chk-grid">
        <label class="fixed"><input type="checkbox" checked disabled> 序号 / 商品名称 / 数量（固定）</label>
        <label v-for="(lb,k) in tplLabels.cols" :key="'c'+k"><input type="checkbox" v-model="tplDraft.cols[k]"> {{lb}}</label>
      </div>
      <div class="section-title" style="margin-top:12px">表尾与签名</div>
      <div class="chk-grid">
        <label v-for="(lb,k) in tplLabels.foot" :key="'f'+k"><input type="checkbox" v-model="tplDraft.foot[k]"> {{lb}}</label>
      </div>
      <div class="form-hint">模版设置全局生效，保存后所有销售单的预览与打印均按此模版输出。</div>
      <template #foot>
        <button class="btn" @click="resetTpl">恢复默认</button>
        <button class="btn" @click="showTpl=false">取消</button>
        <button class="btn btn-primary" @click="saveTpl">保存模版</button>
      </template>
    </x-modal>
  </div>`
};

/* ---------------- 退货管理 ---------------- */
const ReturnList = {
  data() {
    return {
      q: { no: '', saleNo: '', cust: '', goods: '', whId: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, saleId: '', retItems: []
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.returns.filter(r =>
        U.kw(r.no, this.q.no) &&
        U.kw(r.saleNo, this.q.saleNo) &&
        U.kw(S.name('customers', r.customerId), this.q.cust) &&
        (!this.q.goods || (r.items || []).some(it => U.kw(S.name('goods', it.goodsId), this.q.goods))) &&
        (!this.q.whId || r.whId === this.q.whId) &&
        U.inRange(r.createTime, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    sumAmt() { return U.round2(this.rows.reduce((a, r) => a + Number(r.total || 0), 0)); },
    whOptsAll() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    doneSales() { return S.db.sales.filter(s => s.status === '已完成'); },
    saleOpts() {
      return [{ value: '', label: '请选择已完成的销售单' }].concat(this.doneSales.map(s => ({
        value: s.id, label: s.no + ' | ' + S.name('customers', s.customerId) + ' | ￥' + U.fmtMoney(s.total)
      })));
    },
    selSale() { return this.saleId ? S.byId('sales', this.saleId) : null; }
  },
  watch: {
    saleId(v) {
      const s = v ? S.byId('sales', v) : null;
      this.retItems = s ? s.items.map((it, idx) => ({
        itemIdx: idx, goodsName: S.name('goods', it.goodsId), sku: it.sku,
        soldQty: it.qty, returned: S.saleReturnedQty(s.id, idx),
        price: it.price, qty: null
      })) : [];
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    itemsDesc(r) {
      return (r.items || []).map(it => S.name('goods', it.goodsId) + '×' + it.qty).join('、');
    },
    openNew() { this.saleId = ''; this.retItems = []; this.showForm = true; },
    exportData() {
      U.exportExcel('退货明细.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '退货单号': r.no, '销售单号': r.saleNo,
        '客户名称': S.name('customers', r.customerId), '仓库': S.name('warehouses', r.whId),
        '退货明细': this.itemsDesc(r), '退货金额': r.total, '退货时间': r.createTime
      })));
    },
    save() {
      const s = this.selSale;
      if (!s) return alert('请选择销售单');
      const err = S.addReturn(s, this.retItems.map(r => ({ itemIdx: r.itemIdx, qty: Number(r.qty) || 0 })));
      if (err) return alert(err);
      this.showForm = false;
      alert('退货成功，库存已回补，销售净额与欠款已同步冲减');
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.no" placeholder="退货单号" style="width:130px">
      <input type="text" v-model="q.saleNo" placeholder="销售单号" style="width:130px">
      <input type="text" v-model="q.cust" placeholder="客户名称" style="width:120px">
      <input type="text" v-model="q.goods" placeholder="商品名称" style="width:110px">
      <x-combobox v-model="q.whId" :options="whOptsAll" placeholder="全部仓库"/>
      <label>退货时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <span class="muted">退货合计：￥{{fmtMoney(sumAmt)}}</span>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增退货</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr><th>序号</th><th>退货单号</th><th>销售单号</th><th>客户名称</th><th>仓库</th><th>退货明细</th><th class="num">退货金额</th><th>退货时间</th></tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td>{{(page-1)*pageSize+i+1}}</td><td>{{r.no}}</td><td>{{r.saleNo}}</td>
          <td>{{S.name('customers',r.customerId)}}</td><td>{{S.name('warehouses',r.whId)}}</td>
          <td>{{itemsDesc(r)}}</td><td class="num money red">{{fmtMoney(r.total)}}</td><td>{{r.createTime}}</td>
        </tr>
        <tr v-if="!paged.length"><td colspan="8" class="empty">暂无退货记录</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" title="新增退货（依据已完成的销售单）" :width="720" @close="showForm=false">
      <div class="form-item">
        <label>选择销售单<b class="req">*</b></label>
        <x-combobox v-model="saleId" :options="saleOpts" placeholder="请选择已完成的销售单（可输入单号/客户检索）"/>
      </div>
      <div v-if="retItems.length" class="item-rows" style="margin-top:12px">
        <table class="grid">
          <thead><tr><th>商品</th><th>SKU</th><th class="num">销售数量</th><th class="num">已退数量</th><th class="num">单价</th><th style="width:100px">本次退货数量</th></tr></thead>
          <tbody>
            <tr v-for="r in retItems">
              <td>{{r.goodsName}}</td><td>{{r.sku}}</td><td class="num">{{r.soldQty}}</td>
              <td class="num">{{r.returned}}</td><td class="num money">{{fmtMoney(r.price)}}</td>
              <td><input type="number" min="0" :max="r.soldQty-r.returned" style="width:90px" v-model.number="r.qty" placeholder="0"></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="form-hint" style="margin-top:8px">提交后：库存自动回补至原发货仓库，销售净额 / 客户欠款 / 佣金基数同步冲减。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">提交退货</button>
      </template>
    </x-modal>
  </div>`
};

/* ---------------- 结算管理 ---------------- */
const SettleList = {
  data() {
    return { q: { cust: '', pay: '', overdue: false }, page: 1, pageSize: 10, showSettle: false, cur: null, settleForm: { method: '', actualPaid: null, deliveryFee: 0 } };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.sales.filter(s => s.status === '已完成')
        .filter(s =>
          U.kw(S.name('customers', s.customerId), this.q.cust) &&
          (!this.q.pay || s.payStatus === this.q.pay) &&
          (!this.q.overdue || S.saleOverdueDays(s) > 0)
        )
        .map(s => ({
          s, no: s.no, cust: S.name('customers', s.customerId),
          total: s.total, returned: S.saleReturnedAmt(s.id), net: S.saleNet(s),
          delivery: Number(s.deliveryFee || 0),
          due: S.saleDueDate(s), overdue: S.saleOverdueDays(s),
          payStatus: s.payStatus, payTime: s.payTime,
          cycle: (() => { const c = S.byId('customers', s.customerId); return c ? c.payCycle + (c.payDay ? '/' + c.payDay + '号' : '') : ''; })()
        }))
        .sort((a, b) => b.overdue - a.overdue || (b.s.finishTime || '').localeCompare(a.s.finishTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    payOpts() { return [{ value: '', label: '全部支付状态' }, { value: '未支付', label: '未支付' }, { value: '已支付', label: '已支付' }]; },
    methodOpts() { return window.PAY_METHODS.map(m => ({ value: m, label: m })); },
    settleFee() {
      if (!this.cur) return 0;
      const rate = S.feeRateOf(this.settleForm.method);
      return U.round2((Number(this.settleForm.actualPaid) || 0) * rate / 100);
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    markPaid(r) {
      this.cur = r;
      this.settleForm = { method: r.s.payMethod || '', actualPaid: S.salePayable(r.s), deliveryFee: r.s.deliveryFee || 0 };
      this.showSettle = true;
    },
    /* 已支付单据再次修改结算（重选支付方式 / 重录实际收款，并重新计算手续费） */
    editSettle(r) {
      this.cur = r;
      this.settleForm = { method: r.s.payMethod || '', actualPaid: r.s.actualPaid || S.salePayable(r.s), deliveryFee: r.s.deliveryFee || 0 };
      this.showSettle = true;
    },
    confirmSettle() {
      const r = this.cur; if (!r) return;
      if (!this.settleForm.method) return alert('请选择支付方式');
      if (!this.settleForm.actualPaid || this.settleForm.actualPaid <= 0) return alert('请填写实际支付金额');
      r.s.payMethod = this.settleForm.method;
      r.s.actualPaid = U.round2(Number(this.settleForm.actualPaid));
      r.s.fee = this.settleFee;
      r.s.deliveryFee = U.round2(Number(this.settleForm.deliveryFee) || 0);
      r.s.payStatus = '已支付';
      r.s.payTime = U.now();
      this.showSettle = false; this.cur = null;
    },
    unpay(r) {
      if (!U.confirm('撤销支付标记？该单将重新计入客户欠款，且已记录的支付方式/手续费将清空。')) return;
      r.s.payStatus = '未支付';
      r.s.payMethod = r.s.payMethod || '';
      r.s.actualPaid = '';
      r.s.fee = '';
      r.s.payTime = '';
    },
    exportData() {
      U.exportExcel('结算明细.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '销售单号': r.no, '客户名称': r.cust, '账期': r.cycle,
        '销售金额': r.total, '退货金额': r.returned, '税点费用': S.saleTaxCost(r.s), '应收净额(含税)': S.salePayable(r.s),
        '支付方式': r.s.payMethod || '', '实际收款': r.s.actualPaid || '', '手续费': r.s.fee || '', '配送费': r.delivery || 0,
        '应付日期': r.due, '超期天数': r.overdue, '支付状态': r.payStatus, '支付时间': r.payTime || ''
      })));
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.cust" placeholder="客户名称模糊查询">
      <x-combobox v-model="q.pay" :options="payOpts" placeholder="全部支付状态"/>
      <label style="display:flex;align-items:center;gap:4px"><input type="checkbox" v-model="q.overdue">仅看超期</label>
      <div class="spacer"></div>
      <button class="btn" @click="exportData">导出</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>销售单号</th><th>客户名称</th><th>账期</th>
        <th class="num">销售金额</th><th class="num">退货金额</th><th class="num">税点费用</th><th class="num">应收净额(含税)</th>
        <th>支付方式</th><th class="num">实际收款</th><th class="num">手续费</th><th class="num">配送费</th>
        <th>应付日期</th><th>超期</th><th>支付状态</th><th>支付时间</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.no">
          <td>{{(page-1)*pageSize+i+1}}</td><td>{{r.no}}</td><td>{{r.cust}}</td><td>{{r.cycle}}</td>
          <td class="num money">{{fmtMoney(r.total)}}</td>
          <td class="num money" :class="{red:r.returned>0}">{{fmtMoney(r.returned)}}</td>
          <td class="num money" :class="{red:S.saleTaxCost(r.s)>0}">{{fmtMoney(S.saleTaxCost(r.s))}}</td>
          <td class="num money"><b>{{fmtMoney(S.salePayable(r.s))}}</b></td>
          <td>{{r.s.payMethod||'-'}}</td>
          <td class="num money">{{r.s.actualPaid?fmtMoney(r.s.actualPaid):'-'}}</td>
          <td class="num money" :class="{red:r.s.fee>0}">{{r.s.fee?fmtMoney(r.s.fee):'-'}}</td>
          <td class="num money">{{r.delivery?fmtMoney(r.delivery):'-'}}</td>
          <td>{{r.due}}</td>
          <td><span v-if="r.overdue>0" class="tag tag-red">超期{{r.overdue}}天</span><span v-else class="muted">-</span></td>
          <td><x-status :v="r.payStatus"/></td><td>{{r.payTime||'-'}}</td>
          <td class="ops">
            <span v-if="r.payStatus!=='已支付'" class="link green" @click="markPaid(r)">标记已支付</span>
            <template v-else>
              <span class="link" @click="editSettle(r)">修改结算</span>
              <span class="link warn" @click="unpay(r)">撤销支付</span>
            </template>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="17" class="empty">暂无已完成的销售单</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showSettle" title="销售收款结算" :width="520" @close="showSettle=false">
      <div class="form-grid">
        <div class="form-item"><label>销售单号</label><input type="text" :value="cur && cur.s ? cur.s.no : ''" disabled></div>
        <div class="form-item"><label>客户名称</label><input type="text" :value="cur?S.name('customers',cur.s.customerId):''" disabled></div>
        <div class="form-item"><label>应收净额(含税)</label><input type="text" :value="cur?fmtMoney(S.salePayable(cur.s)):''" disabled></div>
        <div class="form-item"><label>支付方式<b class="req">*</b></label><x-combobox v-model="settleForm.method" :options="methodOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>实际支付金额<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="settleForm.actualPaid"></div>
        <div class="form-item"><label>配送费（不计入应收）</label><input type="number" min="0" step="0.01" v-model.number="settleForm.deliveryFee" placeholder="0"></div>
        <div class="form-item full"><label>手续费（成本）</label>
          <input type="text" :value="fmtMoney(settleFee)" disabled>
          <span class="muted" style="font-size:12px">按「系统设置」中该支付方式手续费比例自动计算，结算后固定不变</span></div>
      </div>
      <template #foot>
        <button class="btn" @click="showSettle=false">取消</button>
        <button class="btn btn-primary" @click="confirmSettle">确认收款</button>
      </template>
    </x-modal>
  </div>`
};

Pages['page-sales'] = {
  components: { 'sale-list': SaleList, 'return-list': ReturnList, 'settle-list': SettleList },
  data() { return { tab: '销售管理' }; },
  template: `
  <div>
    <div class="page-title">销售管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['销售管理','退货管理','结算管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <sale-list v-if="tab==='销售管理'"/>
      <return-list v-else-if="tab==='退货管理'"/>
      <settle-list v-else/>
    </div>
  </div>`
};
