/* 财务管理：日常运营 / 其他收入 / 类目管理 */
window.Pages = window.Pages || {};

/* ===== 支出单（日常运营）===== */
const ExpenseList = {
  data() {
    return {
      q: { catId: '', status: '', desc: '', d1: '', d2: '', payMethod: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}, uploadingImage: false, previewList: null, showImagePreview: false
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.expenses.filter(x =>
        (!this.q.catId || x.catId === this.q.catId) &&
        (!this.q.status || x.status === this.q.status) &&
        U.kw(x.desc, this.q.desc) &&
        U.inRange(x.createTime, this.q.d1, this.q.d2) &&
        (!this.q.payMethod || x.payMethod === this.q.payMethod)
      ).slice().sort((a, b) => (U.rankTodo(a.status) - U.rankTodo(b.status)) || (b.createTime || '').localeCompare(a.createTime || ''));
    },
    catOpts() { return [{ value: '', label: '全部类目' }].concat(S.db.expenseCats.map(c => ({ value: c.id, label: c.name }))); },
    catOptsEnabled() { return [{ value: '', label: '请选择' }].concat(S.enabled('expenseCats').map(c => ({ value: c.id, label: c.name }))); },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未计算', label: '未计算' }, { value: '已计算', label: '已计算' }]; },
    payMethodOpts() {
      return [{ value: '', label: '全部支付方式' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m })));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    sumCalc() {
      return U.round2(this.rows.filter(x => x.status === '已计算').reduce((a, x) => a + Number(x.amount), 0));
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    openNew() { this.editing = null; this.form = { catId: '', amount: null, desc: '', payMethod: '', docImages: [] }; this.showForm = true; },
    openEdit(x) {
      if (x.status === '已计算') return alert('已计算的运营单不能修改，请先撤销计算');
      this.editing = x; this.form = { catId: x.catId, amount: x.amount, desc: x.desc, payMethod: x.payMethod || '', docImages: x.docImages ? x.docImages.slice() : [] }; this.showForm = true;
    },
    save() {
      const f = this.form;
      if (!f.catId) return alert('请选择类目');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editing) Object.assign(this.editing, { catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '', docImages: f.docImages || [] });
      else S.db.expenses.push({ id: S.genId(), catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '', docImages: f.docImages || [], createTime: U.now(), status: '未计算' });
      this.showForm = false;
    },
    del(x) {
      if (x.status === '已计算') return alert('已计算的运营单不能删除，请先撤销计算');
      if (!U.confirm('确定删除该运营单吗？')) return;
      S.db.expenses = S.db.expenses.filter(e => e.id !== x.id);
    },
    calc(x) {
      if (!U.confirm('确认计算？该笔支出将计入累计成本统计。')) return;
      x.status = '已计算';
    },
    uncalc(x) {
      if (!U.confirm('撤销计算？该笔支出将从累计成本统计中移除。')) return;
      x.status = '未计算';
    },
    exportData() {
      U.exportExcel('日常运营支出.xlsx', this.rows.map((x, i) => ({
        '序号': i + 1, '类目名称': S.name('expenseCats', x.catId), '金额': x.amount,
        '支付方式': x.payMethod || '-', '详细描述': x.desc, '状态': x.status, '创建时间': x.createTime
      })));
    },
    onDocImageSelect(e) {
      const files = e.target.files;
      if (files && files.length) Array.from(files).forEach(file => this.uploadDocImage(file));
      e.target.value = '';
    },
    async uploadDocImage(file) {
      this.uploadingImage = true;
      try {
        const url = await Cloud.uploadFinanceDoc(file);
        if (!this.form.docImages) this.form.docImages = [];
        this.form.docImages.push(url);
      } catch (err) {
        alert('图片上传失败：' + (err.message || err));
      } finally {
        this.uploadingImage = false;
      }
    },
    onDocImagePaste(e) {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      const files = e.clipboardData && e.clipboardData.files;
      if (!files || !files.length) return;
      Array.from(files).filter(f => f.type && f.type.startsWith('image/')).forEach(img => this.uploadDocImage(img));
    },
    removeDocImage(idx) { if (this.form.docImages) this.form.docImages.splice(idx, 1); },
    openImagePreview(list) { this.previewList = list; this.showImagePreview = true; }
  },
  template: `
  <div>
    <div class="toolbar">
      <x-combobox v-model="q.catId" :options="catOpts" placeholder="全部类目"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="全部状态"/>
      <x-combobox v-model="q.payMethod" :options="payMethodOpts" placeholder="全部支付方式"/>
      <input type="text" v-model="q.desc" placeholder="详细描述模糊查询">
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <span class="muted">已计算合计：￥{{fmtMoney(sumCalc)}}</span>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增运营单</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr><th>序号</th><th>类目名称</th><th class="num">金额</th><th>支付方式</th><th>详细描述</th><th>创建时间</th><th>状态</th><th>图片</th><th>操作</th></tr></thead>
      <tbody>
          <tr v-for="(x,i) in paged" :key="x.id">
          <td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="类目名称">{{S.name('expenseCats',x.catId)}}</td>
          <td class="num money" data-label="金额">{{fmtMoney(x.amount)}}</td><td data-label="支付方式">{{x.payMethod||'—'}}</td><td data-label="详细描述">{{x.desc||'-'}}</td>
          <td data-label="创建时间">{{x.createTime}}</td><td data-label="状态"><x-status :v="x.status"/></td>
          <td data-label="图片">
            <div v-if="x.docImages && x.docImages.length" style="display:flex;gap:4px;flex-wrap:wrap">
              <img v-for="(url,idx) in x.docImages" :key="idx" :src="url" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="openImagePreview(x.docImages)">
            </div>
            <span v-else>-</span>
          </td>
          <td class="ops" data-label="操作">
            <template v-if="x.status==='未计算'">
              <span class="link" @click="openEdit(x)">修改</span>
              <span class="link danger" @click="del(x)">删除</span>
              <span class="link green" @click="calc(x)">计算</span>
            </template>
            <span v-else class="link warn" @click="uncalc(x)">撤销计算</span>
          </td>
        </tr>
        <tr v-if="paged.length" style="background:#eff6ff;font-weight:700">
          <td colspan="2">合计</td>
          <td class="num money">￥{{fmtMoney(paged.reduce((s,x)=>s+Number(x.amount),0))}}</td>
          <td colspan="6"></td>
        </tr>
        <tr v-if="!paged.length"><td colspan="9" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'修改运营单':'新增运营单'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid" @paste="onDocImagePaste">
        <div class="form-item"><label>类目名称<b class="req">*</b></label>
          <x-combobox v-model="form.catId" :options="catOptsEnabled" placeholder="请选择"/></div>
        <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.amount"></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" placeholder="请选择"/></div>
        <div class="form-item full"><label>详细描述</label><textarea rows="2" v-model="form.desc"></textarea></div>
        <div class="form-item full">
          <label>费用明细图片</label>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <input type="file" accept="image/*" multiple class="btn" style="width:auto" @change="onDocImageSelect">
            <span v-if="!$root.isMobile" class="muted">或在此弹窗内按 Ctrl+V 粘贴截图（支持多张）</span>
            <span v-if="uploadingImage" class="muted">上传中…</span>
            <div v-if="form.docImages && form.docImages.length" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <div v-for="(url, idx) in form.docImages" :key="idx" style="display:flex;align-items:center;gap:4px">
                <img :src="url" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="openImagePreview(form.docImages)">
                <span class="link danger" @click="removeDocImage(idx)">删除</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
    <x-modal v-if="showImagePreview" title="图片预览" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showImagePreview=false">
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
        <img v-for="(url,i) in previewList" :key="i" :src="url" style="max-width:100%;max-height:70vh;border-radius:6px;border:1px solid #eee">
      </div>
      <template #foot><button class="btn" @click="showImagePreview=false">关闭</button></template>
    </x-modal>
  </div>`
};

/* ===== 收入单（其他收入）===== */
const IncomeList = {
  data() {
    return {
      q: { catId: '', status: '', desc: '', d1: '', d2: '', payMethod: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}, uploadingImage: false, previewList: null, showImagePreview: false
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.incomes.filter(x =>
        (!this.q.catId || x.catId === this.q.catId) &&
        (!this.q.status || x.status === this.q.status) &&
        U.kw(x.desc, this.q.desc) &&
        U.inRange(x.createTime, this.q.d1, this.q.d2) &&
        (!this.q.payMethod || x.payMethod === this.q.payMethod)
      ).slice().sort((a, b) => (U.rankTodo(a.status) - U.rankTodo(b.status)) || (b.createTime || '').localeCompare(a.createTime || ''));
    },
    catOpts() { return [{ value: '', label: '全部类目' }].concat(S.db.incomeCats.map(c => ({ value: c.id, label: c.name }))); },
    catOptsEnabled() { return [{ value: '', label: '请选择' }].concat(S.enabled('incomeCats').map(c => ({ value: c.id, label: c.name }))); },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '未确认', label: '未确认' }, { value: '已确认', label: '已确认' }]; },
    payMethodOpts() {
      return [{ value: '', label: '全部支付方式' }].concat((window.PAY_METHODS || []).map(m => ({ value: m, label: m })));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    sumConfirmed() {
      return U.round2(this.rows.filter(x => x.status === '已确认').reduce((a, x) => a + Number(x.amount), 0));
    }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    openNew() { this.editing = null; this.form = { catId: '', amount: null, desc: '', payMethod: '', docImages: [] }; this.showForm = true; },
    openEdit(x) {
      if (x.status === '已确认') return alert('已确认的收入单不能修改，请先撤销确认');
      this.editing = x; this.form = { catId: x.catId, amount: x.amount, desc: x.desc, payMethod: x.payMethod || '', docImages: x.docImages ? x.docImages.slice() : [] }; this.showForm = true;
    },
    save() {
      const f = this.form;
      if (!f.catId) return alert('请选择收入类目');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editing) Object.assign(this.editing, { catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '', docImages: f.docImages || [] });
      else S.db.incomes.push({ id: S.genId(), catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '', docImages: f.docImages || [], createTime: U.now(), status: '未确认' });
      this.showForm = false;
    },
    del(x) {
      if (x.status === '已确认') return alert('已确认的收入单不能删除，请先撤销确认');
      if (!U.confirm('确定删除该收入单吗？')) return;
      S.db.incomes = S.db.incomes.filter(e => e.id !== x.id);
    },
    confirm(x) {
      if (!U.confirm('确认入账？该笔收入将计入统计。')) return;
      x.status = '已确认';
    },
    unconfirm(x) {
      if (!U.confirm('撤销确认？该笔收入将从统计中移除。')) return;
      x.status = '未确认';
    },
    exportData() {
      U.exportExcel('其他收入单.xlsx', this.rows.map((x, i) => ({
        '序号': i + 1, '类目名称': S.name('incomeCats', x.catId), '金额': x.amount,
        '支付方式': x.payMethod || '-', '详细描述': x.desc, '状态': x.status, '创建时间': x.createTime
      })));
    },
    onDocImageSelect(e) {
      const files = e.target.files;
      if (files && files.length) Array.from(files).forEach(file => this.uploadDocImage(file));
      e.target.value = '';
    },
    async uploadDocImage(file) {
      this.uploadingImage = true;
      try {
        const url = await Cloud.uploadFinanceDoc(file);
        if (!this.form.docImages) this.form.docImages = [];
        this.form.docImages.push(url);
      } catch (err) {
        alert('图片上传失败：' + (err.message || err));
      } finally {
        this.uploadingImage = false;
      }
    },
    onDocImagePaste(e) {
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
      const files = e.clipboardData && e.clipboardData.files;
      if (!files || !files.length) return;
      Array.from(files).filter(f => f.type && f.type.startsWith('image/')).forEach(img => this.uploadDocImage(img));
    },
    removeDocImage(idx) { if (this.form.docImages) this.form.docImages.splice(idx, 1); },
    openImagePreview(list) { this.previewList = list; this.showImagePreview = true; }
  },
  template: `
  <div>
    <div class="toolbar">
      <x-combobox v-model="q.catId" :options="catOpts" placeholder="全部类目"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="全部状态"/>
      <x-combobox v-model="q.payMethod" :options="payMethodOpts" placeholder="全部支付方式"/>
      <input type="text" v-model="q.desc" placeholder="详细描述模糊查询">
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <span class="muted">已确认合计：￥{{fmtMoney(sumConfirmed)}}</span>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增收入单</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr><th>序号</th><th>类目名称</th><th class="num">金额</th><th>支付方式</th><th>详细描述</th><th>创建时间</th><th>状态</th><th>图片</th><th>操作</th></tr></thead>
      <tbody>
          <tr v-for="(x,i) in paged" :key="x.id">
          <td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="类目名称">{{S.name('incomeCats',x.catId)}}</td>
          <td class="num money" data-label="金额">{{fmtMoney(x.amount)}}</td><td data-label="支付方式">{{x.payMethod||'—'}}</td><td data-label="详细描述">{{x.desc||'-'}}</td>
          <td data-label="创建时间">{{x.createTime}}</td><td data-label="状态"><x-status :v="x.status"/></td>
          <td data-label="图片">
            <div v-if="x.docImages && x.docImages.length" style="display:flex;gap:4px;flex-wrap:wrap">
              <img v-for="(url,idx) in x.docImages" :key="idx" :src="url" style="width:36px;height:36px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="openImagePreview(x.docImages)">
            </div>
            <span v-else>-</span>
          </td>
          <td class="ops" data-label="操作">
            <template v-if="x.status==='未确认'">
              <span class="link" @click="openEdit(x)">修改</span>
              <span class="link danger" @click="del(x)">删除</span>
              <span class="link green" @click="confirm(x)">确认</span>
            </template>
            <span v-else class="link warn" @click="unconfirm(x)">撤销确认</span>
          </td>
        </tr>
        <tr v-if="paged.length" style="background:#eff6ff;font-weight:700">
          <td colspan="2">合计</td>
          <td class="num money">￥{{fmtMoney(paged.reduce((s,x)=>s+Number(x.amount),0))}}</td>
          <td colspan="6"></td>
        </tr>
        <tr v-if="!paged.length"><td colspan="9" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'修改收入单':'新增收入单'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid" @paste="onDocImagePaste">
        <div class="form-item"><label>收入类目<b class="req">*</b></label>
          <x-combobox v-model="form.catId" :options="catOptsEnabled" placeholder="请选择"/></div>
        <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.amount"></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" placeholder="请选择"/></div>
        <div class="form-item full"><label>详细描述</label><textarea rows="2" v-model="form.desc"></textarea></div>
        <div class="form-item full">
          <label>收入单据图片</label>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <input type="file" accept="image/*" multiple class="btn" style="width:auto" @change="onDocImageSelect">
            <span v-if="!$root.isMobile" class="muted">或在此弹窗内按 Ctrl+V 粘贴截图（支持多张）</span>
            <span v-if="uploadingImage" class="muted">上传中…</span>
            <div v-if="form.docImages && form.docImages.length" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <div v-for="(url, idx) in form.docImages" :key="idx" style="display:flex;align-items:center;gap:4px">
                <img :src="url" style="width:48px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #ddd;cursor:pointer" @click="openImagePreview(form.docImages)">
                <span class="link danger" @click="removeDocImage(idx)">删除</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
    <x-modal v-if="showImagePreview" title="图片预览" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showImagePreview=false">
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center">
        <img v-for="(url,i) in previewList" :key="i" :src="url" style="max-width:100%;max-height:70vh;border-radius:6px;border:1px solid #eee">
      </div>
      <template #foot><button class="btn" @click="showImagePreview=false">关闭</button></template>
    </x-modal>
  </div>`
};

/* ===== 财务管理根页面 ===== */
Pages['page-finance'] = {
  components: { 'expense-list': ExpenseList, 'income-list': IncomeList },
  data() { return { tab: '日常运营', catTab: '支出类目' }; },
  template: `
  <div>
    <div class="page-title">财务管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['日常运营','其他收入','类目管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <expense-list v-if="tab==='日常运营'"/>
      <income-list v-else-if="tab==='其他收入'"/>
      <template v-else>
        <div class="tabs" style="margin:-12px -16px 12px;padding:8px 12px 0;border-bottom:1px solid #eef2ff">
          <div class="tab" :class="{active:catTab==='支出类目'}" @click="catTab='支出类目'">支出类目</div>
          <div class="tab" :class="{active:catTab==='收入类目'}" @click="catTab='收入类目'">收入类目</div>
        </div>
        <dict-page coll="expenseCats" label="类目名称" v-if="catTab==='支出类目'"/>
        <dict-page coll="incomeCats" label="类目名称" v-else/>
      </template>
    </div>
  </div>`
};
