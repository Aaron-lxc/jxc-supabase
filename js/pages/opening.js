/* 期初管理：期初库存 / 期初应收 / 期初应付 / 期初资金。
   启用后整体只读；仅创建者/管理员可「反初始化」。 */
window.Pages = window.Pages || {};

Pages['page-opening'] = {
  data() {
    return {
      tab: '期初库存', busy: '', editingStockId: null,
      form: { whId: '', goodsId: '', qty: null, price: null, batchNo: '', productionDate: '', shelfLife: 0, remark: '' },
      formAr: { customerId: '', amount: null, remark: '' },
      formAp: { supplierId: '', amount: null, remark: '' },
      formFund: { payMethod: '', amount: null, remark: '' }
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    ro() {
      /* 已启用期初 → 只读；或当前账号无编辑权限 */
      return S.db.settings.opened || !P.canEdit('opening');
    },
    opened() { return S.db.settings.opened; },
    /* 非管理员且只读（无编辑权限的查看者提示） */
    viewerReadOnly() { return this.ro && !P.isManager(); },
    /* 选项 */
    whOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('warehouses').map(w => ({ value: w.id, label: w.name }))); },
    goodsOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name }))); },
    custOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('customers').map(c => ({ value: c.id, label: c.name }))); },
    supOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('suppliers').map(s => ({ value: s.id, label: s.name }))); },
    fundMethodOpts() { return (window.PAY_METHODS || []).map(m => ({ value: m, label: m })); },
    /* 列表 */
    stockRows() { return S.db.openingStocks; },
    arRows() { return S.db.openingAr; },
    apRows() { return S.db.openingAp; },
    fundRows() { return S.db.openingFunds; },
    /* 汇总 */
    stockValue() { return S.totalOpeningStockValue(); },
    arTotal() { return S.totalOpeningAr(); },
    apTotal() { return S.totalOpeningAp(); },
    fundTotal() { return S.totalOpeningFunds(); },
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
      if (v) { const g = S.byId('goods', v); if (g) this.form.shelfLife = g.shelfLife || 0; }
      else this.form.shelfLife = 0;
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    openTab(t) { this.tab = t; },
    /* ---- 期初库存 ---- */
    addStock() {
      const f = this.form;
      if (!f.whId) return alert('请选择仓库');
      if (!f.goodsId) return alert('请选择商品');
      if (!f.qty || f.qty <= 0) return alert('请填写数量');
      if (f.price == null || f.price < 0) return alert('请填写单价');
      if (this.editingStockId) {
        const r = S.db.openingStocks.find(x => x.id === this.editingStockId);
        if (!r) return alert('未找到要修改的记录');
        Object.assign(r, {
          whId: f.whId, goodsId: f.goodsId, qty: Number(f.qty), price: Number(f.price),
          batchNo: f.batchNo || '', productionDate: f.productionDate || null,
          shelfLife: Number(f.shelfLife) || 0, remark: f.remark || ''
        });
      } else {
        S.db.openingStocks.push({
          id: S.genId(), whId: f.whId, goodsId: f.goodsId,
          qty: Number(f.qty), price: Number(f.price),
          batchNo: f.batchNo || '', productionDate: f.productionDate || null,
          shelfLife: Number(f.shelfLife) || 0, remark: f.remark || ''
        });
      }
      this.resetStockForm();
    },
    editStock(r) {
      this.editingStockId = r.id;
      this.form = {
        whId: r.whId, goodsId: r.goodsId, qty: r.qty, price: r.price,
        batchNo: r.batchNo || '', productionDate: r.productionDate || '',
        shelfLife: r.shelfLife || 0, remark: r.remark || ''
      };
    },
    resetStockForm() {
      this.editingStockId = null;
      this.form = { whId: '', goodsId: '', qty: null, price: null, batchNo: '', productionDate: '', shelfLife: 0, remark: '' };
    },
    cancelEditStock() { this.resetStockForm(); },
    delStock(r) { S.db.openingStocks = S.db.openingStocks.filter(x => x.id !== r.id); },
    /* ---- 期初应收 ---- */
    addAr() {
      const f = this.formAr;
      if (!f.customerId) return alert('请选择客户');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      S.db.openingAr.push({ id: S.genId(), customerId: f.customerId, amount: U.round2(Number(f.amount)), remark: f.remark || '' });
      this.formAr = { customerId: '', amount: null, remark: '' };
    },
    delAr(r) { S.db.openingAr = S.db.openingAr.filter(x => x.id !== r.id); },
    /* ---- 期初应付 ---- */
    addAp() {
      const f = this.formAp;
      if (!f.supplierId) return alert('请选择供应商');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      S.db.openingAp.push({ id: S.genId(), supplierId: f.supplierId, amount: U.round2(Number(f.amount)), remark: f.remark || '' });
      this.formAp = { supplierId: '', amount: null, remark: '' };
    },
    delAp(r) { S.db.openingAp = S.db.openingAp.filter(x => x.id !== r.id); },
    /* ---- 期初资金 ---- */
    addFund() {
      const f = this.formFund;
      if (!f.payMethod) return alert('请选择支付方式');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      S.db.openingFunds.push({ id: S.genId(), payMethod: f.payMethod, amount: U.round2(Number(f.amount)), remark: f.remark || '' });
      this.formFund = { payMethod: '', amount: null, remark: '' };
    },
    delFund(r) { S.db.openingFunds = S.db.openingFunds.filter(x => x.id !== r.id); },
    /* ---- 启用 / 反初始化 ---- */
    async enableOpening() {
      if (!S.db.openingStocks || !S.db.openingStocks.length) return alert('请先在上方「期初库存」中添加至少一条数据，再启用期初。');
      if (!U.confirm('确认启用期初？启用后本模块将只读，且期初库存将并入正式库存。\n（仅当账套无任何业务数据时可启用）')) return;
      const err = S.applyOpening();
      if (err) return alert(err);
      await S.persistNow();   // 立即把并入的库存与「已启用」状态落库，避免刷新/切换后丢失
      alert('期初已启用，库存基准已并入并保存。');
    },
    async reverseOpening() {
      if (!P.isManager()) return alert('仅创建者/管理员可执行反初始化');
      if (!U.confirm('确认反初始化期初？将回滚期初库存并解除只读。\n（仅当账套无任何业务数据时可反初始化）')) return;
      const err = S.reverseOpening();
      if (err) return alert(err);
      await S.persistNow();
      alert('期初已反初始化。');
    }
  },
  template: `
  <div>
    <div class="page-title">期初管理
      <span v-if="opened" class="tag tag-green" style="margin-left:8px">已启用（{{S.db.settings.openTime}}）</span>
      <span v-else class="tag tag-orange" style="margin-left:8px">未启用</span>
    </div>

    <div class="tabs">
      <div class="tab" v-for="t in ['期初库存','期初应收','期初应付','期初资金']" :key="t" :class="{active:tab===t}" @click="openTab(t)">{{t}}</div>
    </div>

    <!-- 只读提示 -->
    <div v-if="viewerReadOnly" class="form-hint" style="margin:10px 0">当前账号对「期初管理」仅有查看权限，且期初已启用为只读，如需修改请联系账套管理员。</div>
    <div v-if="opened" class="form-hint" style="margin:10px 0">期初已启用，数据为只读。如需调整请由创建者/管理员「反初始化」后修改。</div>

    <div class="card">
      <!-- 期初库存 -->
      <template v-if="tab==='期初库存'">
        <div class="toolbar"><b>期初库存</b><div class="spacer"></div>
          <span class="muted">合计库存金额 ￥{{fmtMoney(stockValue)}}</span></div>
        <table class="grid">
          <thead><tr><th>序号</th><th>仓库</th><th>商品</th><th class="num">数量</th><th class="num">单价</th><th class="num">金额</th><th>批次号</th><th>生产日期</th><th>保质期(天)</th><th>到期日</th><th>备注</th><th v-if="!ro">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in stockRows"><td data-label="序号">{{i+1}}</td>
              <td data-label="仓库">{{S.name('warehouses',r.whId)}}</td><td data-label="商品">{{S.name('goods',r.goodsId)}}</td>
              <td class="num" data-label="数量">{{r.qty}}</td><td class="num money" data-label="单价">{{fmtMoney(r.price)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.qty*r.price)}}</td>
              <td data-label="批次号">{{r.batchNo||'未分批次'}}</td>
              <td data-label="生产日期">{{r.productionDate||'-'}}</td>
              <td class="num" data-label="保质期(天)">{{r.shelfLife||0}}</td>
              <td data-label="到期日">{{r.productionDate && (r.shelfLife||0) ? U.addDays(r.productionDate, r.shelfLife||0) : '-'}}</td>
              <td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!ro" class="ops" data-label="操作">
                <span class="link" @click="editStock(r)">修改</span>
                <span class="link danger" @click="delStock(r)" style="margin-left:8px">删除</span>
              </td></tr>
            <tr v-if="!stockRows.length"><td colspan="12" class="empty">暂无期初库存</td></tr>
          </tbody>
        </table>
        <div v-if="!ro" class="form-grid" style="margin-top:12px">
          <div v-if="editingStockId" class="form-hint full" style="margin-bottom:4px">正在修改期初库存，保存后生效。</div>
          <div class="form-item"><label>仓库<b class="req">*</b></label><x-combobox v-model="form.whId" :options="whOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>商品<b class="req">*</b></label><x-combobox v-model="form.goodsId" :options="goodsOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>数量<b class="req">*</b></label><input type="number" min="1" v-model.number="form.qty"></div>
          <div class="form-item"><label>单价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.price"></div>
          <div class="form-item"><label>批次号</label><input type="text" v-model="form.batchNo" placeholder="留空=未分批次"></div>
          <div class="form-item"><label>生产日期</label><input type="date" v-model="form.productionDate"></div>
          <div class="form-item"><label>保质期(天)<span class="muted">（选商品自动带出）</span></label><input type="number" min="0" v-model.number="form.shelfLife"></div>
          <div class="form-item"><label>到期日<span class="muted">（自动计算）</span></label><input type="text" :value="openingExpiry" disabled></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="form.remark" placeholder="选填"></div>
          <div class="form-item">
            <button class="btn btn-primary" @click="addStock">{{editingStockId?'保存修改':'添加期初库存'}}</button>
            <button v-if="editingStockId" class="btn" @click="cancelEditStock" style="margin-left:8px">取消</button>
          </div>
        </div>
      </template>

      <!-- 期初应收 -->
      <template v-else-if="tab==='期初应收'">
        <div class="toolbar"><b>期初应收（客户欠款）</b><div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(arTotal)}}</span></div>
        <table class="grid">
          <thead><tr><th>序号</th><th>客户</th><th class="num">金额</th><th>备注</th><th v-if="!ro">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in arRows"><td data-label="序号">{{i+1}}</td><td data-label="客户">{{S.name('customers',r.customerId)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!ro" class="ops" data-label="操作"><span class="link danger" @click="delAr(r)">删除</span></td></tr>
            <tr v-if="!arRows.length"><td colspan="5" class="empty">暂无期初应收</td></tr>
          </tbody>
        </table>
        <div v-if="!ro" class="form-grid" style="margin-top:12px">
          <div class="form-item"><label>客户<b class="req">*</b></label><x-combobox v-model="formAr.customerId" :options="custOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formAr.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formAr.remark" placeholder="选填"></div>
          <div class="form-item"><button class="btn btn-primary" @click="addAr">添加期初应收</button></div>
        </div>
      </template>

      <!-- 期初应付 -->
      <template v-else-if="tab==='期初应付'">
        <div class="toolbar"><b>期初应付（供应商欠款）</b><div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(apTotal)}}</span></div>
        <table class="grid">
          <thead><tr><th>序号</th><th>供应商</th><th class="num">金额</th><th>备注</th><th v-if="!ro">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in apRows"><td data-label="序号">{{i+1}}</td><td data-label="供应商">{{S.name('suppliers',r.supplierId)}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!ro" class="ops" data-label="操作"><span class="link danger" @click="delAp(r)">删除</span></td></tr>
            <tr v-if="!apRows.length"><td colspan="5" class="empty">暂无期初应付</td></tr>
          </tbody>
        </table>
        <div v-if="!ro" class="form-grid" style="margin-top:12px">
          <div class="form-item"><label>供应商<b class="req">*</b></label><x-combobox v-model="formAp.supplierId" :options="supOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formAp.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formAp.remark" placeholder="选填"></div>
          <div class="form-item"><button class="btn btn-primary" @click="addAp">添加期初应付</button></div>
        </div>
      </template>

      <!-- 期初资金（按支付方式维度录入） -->
      <template v-else>
        <div class="toolbar"><b>期初资金（按支付方式）</b><div class="spacer"></div>
          <span class="muted">合计 ￥{{fmtMoney(fundTotal)}}</span></div>
        <table class="grid">
          <thead><tr><th>序号</th><th>支付方式</th><th class="num">金额</th><th>备注</th><th v-if="!ro">操作</th></tr></thead>
          <tbody>
            <tr v-for="(r,i) in fundRows"><td data-label="序号">{{i+1}}</td><td data-label="支付方式">{{r.payMethod}}</td>
              <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="备注">{{r.remark||'-'}}</td>
              <td v-if="!ro" class="ops" data-label="操作"><span class="link danger" @click="delFund(r)">删除</span></td></tr>
            <tr v-if="!fundRows.length"><td colspan="5" class="empty">暂无期初资金</td></tr>
          </tbody>
        </table>
        <div v-if="!ro" class="form-grid" style="margin-top:12px">
          <div class="form-item"><label>支付方式<b class="req">*</b></label><x-combobox v-model="formFund.payMethod" :options="fundMethodOpts" placeholder="请选择"/></div>
          <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="formFund.amount"></div>
          <div class="form-item full"><label>备注</label><input type="text" v-model="formFund.remark" placeholder="选填"></div>
          <div class="form-item"><button class="btn btn-primary" @click="addFund">添加期初资金</button></div>
        </div>
      </template>
    </div>

    <!-- 启用 / 反初始化 -->
    <div class="card" style="margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <template v-if="!opened">
        <button class="btn btn-primary" :disabled="ro" @click="enableOpening">确认启用期初</button>
        <span class="muted">启用后库存/应收/应付/资金基准将生效，本模块转为只读。</span>
      </template>
      <template v-else>
        <button class="btn btn-danger" v-if="P.isManager()" @click="reverseOpening">反初始化期初</button>
        <span class="muted">仅创建者/管理员可反初始化；反初始化会回滚期初库存。</span>
      </template>
    </div>
  </div>`
};
