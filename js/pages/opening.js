/* 期初管理：期初库存 / 期初应收 / 期初应付 / 期初资金。
   4 个 Tab 的启用/反初始化各自独立；列表支持分页与筛选；期初应收支持历史单据图片。 */
window.Pages = window.Pages || {};

Pages['page-opening'] = {
  data() {
    return {
      tab: '期初库存', busy: '', uploadingImageCount: 0,
      editingStockId: null,
      priceTouched: false,
      editingArId: null, editingApId: null, editingFundId: null,
      form: { whId: '', goodsId: '', qty: null, price: null, batchNo: '', productionDate: '', shelfLife: 0, remark: '' },
      formAr: { customerId: '', amount: null, remark: '', docImages: [] },
      formAp: { supplierId: '', amount: null, remark: '' },
      formFund: { payMethod: '', amount: null, remark: '' },
      /* 分页 */
      pageStock: 1, sizeStock: 10,
      pageAr: 1, sizeAr: 10,
      pageAp: 1, sizeAp: 10,
      pageFund: 1, sizeFund: 10,
      /* 筛选 */
      qStock: { whId: '', goodsId: '', kw: '' },
      qAr: { customerId: '', remark: '' },
      qAp: { supplierId: '' },
      /* 图片预览 */
      previewImage: '', showImagePreview: false
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    uploadingImage() { return this.uploadingImageCount > 0; },
    /* 有期初编辑权限即可看到添加表单 */
    canEditOpening() { return P.canEdit('opening'); },
    viewerReadOnly() { return !P.canEdit('opening') && !P.isManager(); },
    /* 各 Tab 启用状态 */
    openedStock() { return !!S.db.settings.openingFlags.stock; },
    openedAr()    { return !!S.db.settings.openingFlags.ar; },
    openedAp()    { return !!S.db.settings.openingFlags.ap; },
    openedFund()  { return !!S.db.settings.openingFlags.funds; },
    /* 选项：表单用（含“请选择”） */
    whOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('warehouses').map(w => ({ value: w.id, label: w.name }))); },
    goodsOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name }))); },
    custOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('customers').map(c => ({ value: c.id, label: c.name }))); },
    supOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('suppliers').map(s => ({ value: s.id, label: s.name }))); },
    fundMethodOpts() { return (window.PAY_METHODS || []).map(m => ({ value: m, label: m })); },
    /* 选项：筛选用（含“全部”） */
    filterWhOpts() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    filterGoodsOpts() { return [{ value: '', label: '全部商品' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name }))); },
    filterCustOpts() { return [{ value: '', label: '全部客户' }].concat(S.enabled('customers').map(c => ({ value: c.id, label: c.name }))); },
    filterSupOpts() { return [{ value: '', label: '全部供应商' }].concat(S.enabled('suppliers').map(s => ({ value: s.id, label: s.name }))); },
    /* 列表：先过滤再分页 */
    stockRows() {
      return S.db.openingStocks.filter(r =>
        (!this.qStock.whId || r.whId === this.qStock.whId) &&
        (!this.qStock.goodsId || r.goodsId === this.qStock.goodsId) &&
        (U.kw(r.batchNo, this.qStock.kw) || U.kw(r.remark, this.qStock.kw) || U.kw(S.name('warehouses', r.whId), this.qStock.kw) || U.kw(S.name('goods', r.goodsId), this.qStock.kw))
      );
    },
    arRows() {
      return S.db.openingAr.filter(r =>
        (!this.qAr.customerId || r.customerId === this.qAr.customerId) &&
        U.kw(r.remark, this.qAr.remark)
      );
    },
    apRows() {
      return S.db.openingAp.filter(r =>
        (!this.qAp.supplierId || r.supplierId === this.qAp.supplierId)
      );
    },
    fundRows() { return S.db.openingFunds; },
    stockPaged() { return this.stockRows.slice((this.pageStock - 1) * this.sizeStock, this.pageStock * this.sizeStock); },
    arPaged()    { return this.arRows.slice((this.pageAr - 1) * this.sizeAr, this.pageAr * this.sizeAr); },
    apPaged()    { return this.apRows.slice((this.pageAp - 1) * this.sizeAp, this.pageAp * this.sizeAp); },
    fundPaged()  { return this.fundRows.slice((this.pageFund - 1) * this.sizeFund, this.pageFund * this.sizeFund); },
    /* 合计基于当前筛选结果 */
    stockValue() { return U.round2(this.stockRows.reduce((a, o) => a + Number(o.qty || 0) * Number(o.price || 0), 0)); },
    arTotal()    { return U.round2(this.arRows.reduce((a, x) => a + Number(x.amount || 0), 0)); },
    apTotal()    { return U.round2(this.apRows.reduce((a, x) => a + Number(x.amount || 0), 0)); },
    fundTotal()  { return U.round2(this.fundRows.reduce((a, x) => a + Number(x.amount || 0), 0)); },
    /* 期初库存选中的商品（用于带出保质期/计算到期日） */
    selGoods() { return this.form.goodsId ? S.byId('goods', this.form.goodsId) : null; },
    openingExpiry() {
      const g = this.selGoods;
      if (this.form.productionDate && g && g.shelfLife) return U.addDays(this.form.productionDate, g.shelfLife);
      return '';
    }
  },
  watch: {
    'form.goodsId'(v) {
      if (v) {
        const g = S.byId('goods', v);
        if (g) {
          this.form.shelfLife = g.shelfLife || 0;
          if (!this.priceTouched) this.form.price = g.purchasePrice || 0;
        }
      } else {
        this.form.shelfLife = 0;
      }
    }
  },
  mounted() {
    document.addEventListener('paste', this.onDocImagePaste);
  },
  unmounted() {
    document.removeEventListener('paste', this.onDocImagePaste);
  },
  methods: {
    fmtMoney: U.fmtMoney,
    openTab(t) { this.tab = t; },
    tabLabel(t) { return { '期初库存': '库存', '期初应收': '应收', '期初应付': '应付', '期初资金': '资金' }[t] || t; },
    /* ---- 期初库存 ---- */
    async addStock() {
      const f = this.form;
      if (!f.whId) return alert('请选择仓库');
      if (!f.goodsId) return alert('请选择商品');
      if (!f.qty || f.qty <= 0) return alert('请填写数量');
      if (f.price == null || f.price < 0) return alert('请填写单价');
      if (this.editingStockId) {
        if (this.openedStock) {   // 已启用时不许改历史
          this.resetStockForm();
          return alert('期初库存已启用，不可修改历史记录。如需调整请先由管理员「反初始化期初库存」。');
        }
        const r = S.db.openingStocks.find(x => x.id === this.editingStockId);
        if (!r) return alert('未找到要修改的记录');
        Object.assign(r, {
          whId: f.whId, goodsId: f.goodsId, qty: Number(f.qty), price: Number(f.price),
          batchNo: f.batchNo || '', productionDate: f.productionDate || null,
          shelfLife: Number(f.shelfLife) || 0, remark: f.remark || ''
        });
      } else {
        const rec = {
          id: S.genId(), whId: f.whId, goodsId: f.goodsId,
          qty: Number(f.qty), price: Number(f.price),
          batchNo: f.batchNo || '', productionDate: f.productionDate || null,
          shelfLife: Number(f.shelfLife) || 0, remark: f.remark || ''
        };
        S.db.openingStocks.push(rec);
        if (this.openedStock) {   // 启用后补录：立即并入正式库存并保存
          S.applyOpeningOne(rec);
          await S.persistNow();
          alert('已补录期初库存并并入现有库存。');
        }
      }
      this.resetStockForm();
    },
    editStock(r) {
      this.editingStockId = r.id;
      this.priceTouched = false;
      this.form = {
        whId: r.whId, goodsId: r.goodsId, qty: r.qty, price: r.price,
        batchNo: r.batchNo || '', productionDate: r.productionDate || '',
        shelfLife: r.shelfLife || 0, remark: r.remark || ''
      };
    },
    resetStockForm() {
      this.editingStockId = null;
      this.priceTouched = false;
      this.form = { whId: '', goodsId: '', qty: null, price: null, batchNo: '', productionDate: '', shelfLife: 0, remark: '' };
    },
    cancelEditStock() { this.resetStockForm(); },
    delStock(r) { S.db.openingStocks = S.db.openingStocks.filter(x => x.id !== r.id); },
    /* ---- 期初应收 ---- */
    async addAr() {
      const f = this.formAr;
      if (!f.customerId) return alert('请选择客户');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editingArId) {
        if (this.openedAr) { this.resetArForm(); return alert('期初应收已启用，不可修改历史记录。如需调整请先由管理员「反初始化期初应收」。'); }
        const r = S.db.openingAr.find(x => x.id === this.editingArId);
        if (!r) return alert('未找到要修改的记录');
        const imgs = Array.isArray(f.docImages) ? f.docImages.slice() : (f.docImage ? [f.docImage] : []);
        Object.assign(r, { customerId: f.customerId, amount: U.round2(Number(f.amount)), remark: f.remark || '', docImages: imgs, docImage: imgs[0] || '' });
      } else {
        const imgs = Array.isArray(f.docImages) ? f.docImages.slice() : (f.docImage ? [f.docImage] : []);
        const rec = { id: S.genId(), customerId: f.customerId, amount: U.round2(Number(f.amount)), remark: f.remark || '', docImages: imgs, docImage: imgs[0] || '' };
        S.db.openingAr.push(rec);
        if (this.openedAr) { await S.persistNow(); alert('已补录期初应收。'); }   // 启用后补录：立即落库（客户台账实时计入）
      }
      this.resetArForm();
    },
    editAr(r) {
      this.editingArId = r.id;
      this.formAr = { customerId: r.customerId, amount: r.amount, remark: r.remark || '', docImages: this._normDocImages(r) };
    },
    resetArForm() { this.editingArId = null; this.formAr = { customerId: '', amount: null, remark: '', docImages: [] }; },
    cancelEditAr() { this.resetArForm(); },
    delAr(r) { S.db.openingAr = S.db.openingAr.filter(x => x.id !== r.id); },
    /* 兼容旧数据的单字符串 docImage：统一转为数组 */
    _normDocImages(r) {
      if (!r) return [];
      if (Array.isArray(r.docImages)) return r.docImages.slice();
      if (r.docImage) return [r.docImage];
      return [];
    },
    /* ---- 期初应付 ---- */
    async addAp() {
      const f = this.formAp;
      if (!f.supplierId) return alert('请选择供应商');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editingApId) {
        if (this.openedAp) { this.resetApForm(); return alert('期初应付已启用，不可修改历史记录。如需调整请先由管理员「反初始化期初应付」。'); }
        const r = S.db.openingAp.find(x => x.id === this.editingApId);
        if (!r) return alert('未找到要修改的记录');
        Object.assign(r, { supplierId: f.supplierId, amount: U.round2(Number(f.amount)), remark: f.remark || '' });
      } else {
        const rec = { id: S.genId(), supplierId: f.supplierId, amount: U.round2(Number(f.amount)), remark: f.remark || '' };
        S.db.openingAp.push(rec);
        if (this.openedAp) { await S.persistNow(); alert('已补录期初应付。'); }   // 启用后补录：立即落库（供应商台账实时计入）
      }
      this.resetApForm();
    },
    editAp(r) {
      this.editingApId = r.id;
      this.formAp = { supplierId: r.supplierId, amount: r.amount, remark: r.remark || '' };
    },
    resetApForm() { this.editingApId = null; this.formAp = { supplierId: '', amount: null, remark: '' }; },
    cancelEditAp() { this.resetApForm(); },
    delAp(r) { S.db.openingAp = S.db.openingAp.filter(x => x.id !== r.id); },
    /* ---- 期初资金 ---- */
    async addFund() {
      const f = this.formFund;
      if (!f.payMethod) return alert('请选择支付方式');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editingFundId) {
        if (this.openedFund) { this.resetFundForm(); return alert('期初资金已启用，不可修改历史记录。如需调整请先由管理员「反初始化期初资金」。'); }
        const r = S.db.openingFunds.find(x => x.id === this.editingFundId);
        if (!r) return alert('未找到要修改的记录');
        Object.assign(r, { payMethod: f.payMethod, amount: U.round2(Number(f.amount)), remark: f.remark || '' });
      } else {
        const rec = { id: S.genId(), payMethod: f.payMethod, amount: U.round2(Number(f.amount)), remark: f.remark || '' };
        S.db.openingFunds.push(rec);
        if (this.openedFund) { await S.persistNow(); alert('已补录期初资金。'); }
      }
      this.resetFundForm();
    },
    editFund(r) {
      this.editingFundId = r.id;
      this.formFund = { payMethod: r.payMethod, amount: r.amount, remark: r.remark || '' };
    },
    resetFundForm() { this.editingFundId = null; this.formFund = { payMethod: '', amount: null, remark: '' }; },
    cancelEditFund() { this.resetFundForm(); },
    delFund(r) { S.db.openingFunds = S.db.openingFunds.filter(x => x.id !== r.id); },
    /* ---- 各 Tab 启用 / 反初始化 ---- */
    async enable(type) {
      const labels = { stock: '期初库存', ar: '期初应收', ap: '期初应付', funds: '期初资金' };
      if (type === 'stock' && !S.db.openingStocks.length) return alert('请先在上方「期初库存」中添加至少一条数据，再启用。');
      if (!U.confirm(`确认启用${labels[type]}？启用后该模块历史记录将只读，如需修改/删除需由管理员「反初始化」。`)) return;
      const err = S.applyOpening(type);
      if (err) return alert(err);
      await S.persistNow();
      alert(`${labels[type]}已启用。`);
    },
    async reverse(type) {
      const labels = { stock: '期初库存', ar: '期初应收', ap: '期初应付', funds: '期初资金' };
      if (!P.isManager()) return alert('仅创建者/管理员可执行反初始化');
      if (!U.confirm(`确认反初始化${labels[type]}？将回滚该模块期初数据并解除只读。`)) return;
      const err = S.reverseOpening(type);
      if (err) return alert(err);
      await S.persistNow();
      alert(`${labels[type]}已反初始化。`);
    },
    /* ---- 历史单据图片（仅期初应收，支持多张） ---- */
    onDocImageSelect(e) {
      const files = e.target.files;
      if (files && files.length) {
        Array.from(files).forEach(file => this.uploadDocImage(file));
      }
      e.target.value = '';
    },
    async uploadDocImage(file) {
      this.uploadingImageCount++;
      try {
        const url = await Cloud.uploadOpeningDoc(file);
        if (!this.formAr.docImages) this.formAr.docImages = [];
        this.formAr.docImages.push(url);
      } catch (err) {
        alert('图片上传失败：' + (err.message || err));
      } finally {
        this.uploadingImageCount--;
      }
    },
    onDocImagePaste(e) {
      if (this.tab !== '期初应收') return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) return;
      const files = e.clipboardData && e.clipboardData.files;
      if (!files || !files.length) return;
      const imgs = Array.from(files).filter(f => f.type && f.type.startsWith('image/'));
      if (imgs.length) { e.preventDefault(); imgs.forEach(img => this.uploadDocImage(img)); }
    },
    removeDocImage(idx) {
      if (this.formAr.docImages && idx >= 0 && idx < this.formAr.docImages.length) this.formAr.docImages.splice(idx, 1);
    }
  },
  template: `
  <div>
    <div class="page-title">期初管理
      <span v-if="openedStock||openedAr||openedAp||openedFund" class="tag tag-green" style="margin-left:8px">已启用</span>
      <span v-else class="tag tag-orange" style="margin-left:8px">未启用</span>
    </div>

    <div class="tabs">
      <div class="tab" v-for="t in ['期初库存','期初应收','期初应付','期初资金']" :key="t" :class="{active:tab===t}" @click="openTab(t)">
        {{t}}
        <span v-if="{ '期初库存': openedStock, '期初应收': openedAr, '期初应付': openedAp, '期初资金': openedFund }[t]" class="tag tag-green" style="margin-left:4px;font-size:10px;padding:1px 4px">已启用</span>
      </div>
    </div>

    <!-- 只读提示 -->
    <div v-if="viewerReadOnly" class="form-hint" style="margin:10px 0">当前账号对「期初管理」仅有查看权限，如需修改请联系账套管理员。</div>
    <div v-if="openedStock||openedAr||openedAp||openedFund" class="form-hint" style="margin:10px 0">部分期初已启用：历史记录为只读，但下方仍可<b>补录新增</b>对应 Tab 的期初数据；如需修改/删除历史记录，请由创建者/管理员对该 Tab 执行「反初始化」。</div>

    <div class="card">
      <!-- 期初库存 -->
      <template v-if="tab==='期初库存'">
        <div class="toolbar">
          <b>期初库存</b>
          <x-combobox v-model="qStock.whId" :options="filterWhOpts" placeholder="全部仓库" style="width:140px"/>
          <x-combobox v-model="qStock.goodsId" :options="filterGoodsOpts" placeholder="全部商品" style="width:180px"/>
          <input type="text" v-model="qStock.kw" placeholder="批次号/备注模糊查询" style="width:160px">
          <div class="spacer"></div>
          <span class="muted">合计库存金额 ￥{{fmtMoney(stockValue)}}</span>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th>仓库</th><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th><th>批次号</th><th>生产日期</th><th>保质期(天)</th><th>到期日</th><th>备注</th><th v-if="!openedStock">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in stockPaged"><td data-label="序号">{{(pageStock-1)*sizeStock+i+1}}</td>
              <td data-label="仓库">{{S.name('warehouses',r.whId)}}</td><td data-label="商品">{{S.name('goods',r.goodsId)}}</td>
              <td class="num" data-label="数量">{{r.qty}}</td><td class="num money" data-label="单价">{{fmtMoney(r.price)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.qty*r.price)}}</td>
              <td data-label="批次号">{{r.batchNo||'未分批次'}}</td>
              <td data-label="生产日期">{{r.productionDate||'-'}}</td>
              <td class="num" data-label="保质期(天)">{{r.shelfLife||0}}</td>
              <td data-label="到期日">{{r.productionDate && (r.shelfLife||0) ? U.addDays(r.productionDate, r.shelfLife||0) : '-'}}</td>
              <td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!openedStock" class="ops" data-label="操作">
                <span class="link" @click="editStock(r)">修改</span>
                <span class="link danger" @click="delStock(r)" style="margin-left:8px">删除</span>
              </td></tr>
            <tr v-if="!stockPaged.length"><td colspan="12" class="empty">暂无期初库存</td></tr>
          </tbody>
        </table>
        <x-pager :total="stockRows.length" v-model:page="pageStock" v-model:size="sizeStock"/>
        <div v-if="canEditOpening" class="form-grid" style="margin-top:12px">
          <div v-if="editingStockId && !openedStock" class="form-hint full" style="margin-bottom:4px">正在修改期初库存，保存后生效。</div>
          <div class="form-item"><label>仓库<b class="req">*</b></label><x-combobox v-model="form.whId" :options="whOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>商品<b class="req">*</b></label><x-combobox v-model="form.goodsId" :options="goodsOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>数量<b class="req">*</b></label><input type="number" min="1" v-model.number="form.qty"></div>
          <div class="form-item"><label>单价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.price" @input="priceTouched = true"></div>
          <div class="form-item"><label>批次号<span class="muted">（留空=启用时自动生成 QC-日期-序号）</span></label><input type="text" v-model="form.batchNo" placeholder="留空=自动生成"></div>
          <div class="form-item"><label>生产日期</label><input type="date" v-model="form.productionDate"></div>
          <div class="form-item"><label>保质期(天)<span class="muted">（选商品自动带出）</span></label><input type="number" min="0" v-model.number="form.shelfLife"></div>
          <div class="form-item"><label>到期日<span class="muted">（自动计算）</span></label><input type="text" :value="openingExpiry" disabled></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="form.remark" placeholder="选填"></div>
          <div class="form-item">
            <button class="btn btn-primary" @click="addStock">{{editingStockId?'保存修改':'添加期初库存'}}</button>
            <button v-if="editingStockId" class="btn" @click="cancelEditStock" style="margin-left:8px">取消</button>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <template v-if="!openedStock">
            <button class="btn btn-primary" :disabled="!canEditOpening" @click="enable('stock')">确认启用期初库存</button>
            <span class="muted">启用后库存基准生效，历史记录转为只读。</span>
          </template>
          <template v-else>
            <button class="btn btn-danger" v-if="P.isManager()" @click="reverse('stock')">反初始化期初库存</button>
            <span class="muted">仅创建者/管理员可反初始化；反初始化会回滚期初库存。</span>
          </template>
        </div>
      </template>

      <!-- 期初应收 -->
      <template v-else-if="tab==='期初应收'">
        <div class="toolbar">
          <b>期初应收（客户欠款）</b>
          <x-combobox v-model="qAr.customerId" :options="filterCustOpts" placeholder="全部客户" style="width:180px"/>
          <input type="text" v-model="qAr.remark" placeholder="备注模糊查询" style="width:160px">
          <div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(arTotal)}}</span>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th>客户</th><th class="num">金额</th><th>备注</th><th>历史单据</th><th v-if="!openedAr">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in arPaged"><td data-label="序号">{{(pageAr-1)*sizeAr+i+1}}</td><td data-label="客户">{{S.name('customers',r.customerId)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td data-label="历史单据">
                <span v-if="!_normDocImages(r).length" class="muted">-</span>
                <div v-else style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                  <img v-for="(url, idx) in _normDocImages(r)" :key="idx" :src="url" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="previewImage=url; showImagePreview=true">
                </div>
              </td>
              <td v-if="!openedAr" class="ops" data-label="操作">
                <span class="link" @click="editAr(r)">修改</span>
                <span class="link danger" @click="delAr(r)" style="margin-left:8px">删除</span></td></tr>
            <tr v-if="!arPaged.length"><td colspan="6" class="empty">暂无期初应收</td></tr>
          </tbody>
        </table>
        <x-pager :total="arRows.length" v-model:page="pageAr" v-model:size="sizeAr"/>
        <div v-if="canEditOpening" class="form-grid" style="margin-top:12px">
          <div v-if="editingArId && !openedAr" class="form-hint full" style="margin-bottom:4px">正在修改期初应收，保存后生效。</div>
          <div class="form-item"><label>客户<b class="req">*</b></label><x-combobox v-model="formAr.customerId" :options="custOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formAr.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formAr.remark" placeholder="选填"></div>
          <div class="form-item full">
            <label>历史单据</label>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <input type="file" accept="image/*" multiple ref="arFile" style="display:none" @change="onDocImageSelect">
              <button class="btn" @click="$refs.arFile.click()">上传图片</button>
              <span class="muted">或在此页面按 Ctrl+V 粘贴截图（支持多张）</span>
              <span v-if="uploadingImage" class="muted">上传中…</span>
              <div v-if="formAr.docImages && formAr.docImages.length" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <div v-for="(url, idx) in formAr.docImages" :key="idx" style="display:flex;align-items:center;gap:4px">
                  <img :src="url" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="previewImage=url; showImagePreview=true">
                  <span class="link danger" @click="removeDocImage(idx)">删除</span>
                </div>
              </div>
            </div>
          </div>
          <div class="form-item">
            <button class="btn btn-primary" @click="addAr">{{editingArId?'保存修改':'添加期初应收'}}</button>
            <button v-if="editingArId" class="btn" @click="cancelEditAr" style="margin-left:8px">取消</button>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <template v-if="!openedAr">
            <button class="btn btn-primary" :disabled="!canEditOpening" @click="enable('ar')">确认启用期初应收</button>
            <span class="muted">启用后应收基准生效，历史记录转为只读，并计入客户累计欠款。</span>
          </template>
          <template v-else>
            <button class="btn btn-danger" v-if="P.isManager()" @click="reverse('ar')">反初始化期初应收</button>
            <span class="muted">仅创建者/管理员可反初始化；反初始化后不再计入客户累计欠款。</span>
          </template>
        </div>
      </template>

      <!-- 期初应付 -->
      <template v-else-if="tab==='期初应付'">
        <div class="toolbar">
          <b>期初应付（供应商欠款）</b>
          <x-combobox v-model="qAp.supplierId" :options="filterSupOpts" placeholder="全部供应商" style="width:180px"/>
          <div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(apTotal)}}</span>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th>供应商</th><th class="num">金额</th><th>备注</th><th v-if="!openedAp">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in apPaged"><td data-label="序号">{{(pageAp-1)*sizeAp+i+1}}</td><td data-label="供应商">{{S.name('suppliers',r.supplierId)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!openedAp" class="ops" data-label="操作">
                <span class="link" @click="editAp(r)">修改</span>
                <span class="link danger" @click="delAp(r)" style="margin-left:8px">删除</span></td></tr>
            <tr v-if="!apPaged.length"><td colspan="5" class="empty">暂无期初应付</td></tr>
          </tbody>
        </table>
        <x-pager :total="apRows.length" v-model:page="pageAp" v-model:size="sizeAp"/>
        <div v-if="canEditOpening" class="form-grid" style="margin-top:12px">
          <div v-if="editingApId && !openedAp" class="form-hint full" style="margin-bottom:4px">正在修改期初应付，保存后生效。</div>
          <div class="form-item"><label>供应商<b class="req">*</b></label><x-combobox v-model="formAp.supplierId" :options="supOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formAp.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formAp.remark" placeholder="选填"></div>
          <div class="form-item">
            <button class="btn btn-primary" @click="addAp">{{editingApId?'保存修改':'添加期初应付'}}</button>
            <button v-if="editingApId" class="btn" @click="cancelEditAp" style="margin-left:8px">取消</button>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <template v-if="!openedAp">
            <button class="btn btn-primary" :disabled="!canEditOpening" @click="enable('ap')">确认启用期初应付</button>
            <span class="muted">启用后应付基准生效，历史记录转为只读，并计入供应商累计应付。</span>
          </template>
          <template v-else>
            <button class="btn btn-danger" v-if="P.isManager()" @click="reverse('ap')">反初始化期初应付</button>
            <span class="muted">仅创建者/管理员可反初始化；反初始化后不再计入供应商累计应付。</span>
          </template>
        </div>
      </template>

      <!-- 期初资金 -->
      <template v-else>
        <div class="toolbar">
          <b>期初资金（按支付方式）</b>
          <div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(fundTotal)}}</span>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th>支付方式</th><th class="num">金额</th><th>备注</th><th v-if="!openedFund">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in fundPaged"><td data-label="序号">{{(pageFund-1)*sizeFund+i+1}}</td><td data-label="支付方式">{{r.payMethod}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!openedFund" class="ops" data-label="操作">
                <span class="link" @click="editFund(r)">修改</span>
                <span class="link danger" @click="delFund(r)" style="margin-left:8px">删除</span></td></tr>
            <tr v-if="!fundPaged.length"><td colspan="5" class="empty">暂无期初资金</td></tr>
          </tbody>
        </table>
        <x-pager :total="fundRows.length" v-model:page="pageFund" v-model:size="sizeFund"/>
        <div v-if="canEditOpening" class="form-grid" style="margin-top:12px">
          <div v-if="editingFundId && !openedFund" class="form-hint full" style="margin-bottom:4px">正在修改期初资金，保存后生效。</div>
          <div class="form-item"><label>支付方式<b class="req">*</b></label><x-combobox v-model="formFund.payMethod" :options="fundMethodOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formFund.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formFund.remark" placeholder="选填"></div>
          <div class="form-item">
            <button class="btn btn-primary" @click="addFund">{{editingFundId?'保存修改':'添加期初资金'}}</button>
            <button v-if="editingFundId" class="btn" @click="cancelEditFund" style="margin-left:8px">取消</button>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <template v-if="!openedFund">
            <button class="btn btn-primary" :disabled="!canEditOpening" @click="enable('funds')">确认启用期初资金</button>
            <span class="muted">启用后资金基准生效，历史记录转为只读。</span>
          </template>
          <template v-else>
            <button class="btn btn-danger" v-if="P.isManager()" @click="reverse('funds')">反初始化期初资金</button>
            <span class="muted">仅创建者/管理员可反初始化。</span>
          </template>
        </div>
      </template>
    </div>

    <!-- 图片预览弹窗 -->
    <x-modal v-if="showImagePreview" title="查看原图" :width="900" :fullscreen="$root.isMobile" @close="showImagePreview=false">
      <img :src="previewImage" style="max-width:100%;display:block;margin:0 auto">
    </x-modal>
  </div>`
};
