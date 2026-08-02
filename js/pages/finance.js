/* 财务管理：日常运营 / 类目管理 */
window.Pages = window.Pages || {};

const ExpenseList = {
  data() {
    return {
      q: { catId: '', status: '', desc: '', d1: '', d2: '', payMethod: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}
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
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
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
    openNew() { this.editing = null; this.form = { catId: '', amount: null, desc: '', payMethod: '' }; this.showForm = true; },
    openEdit(x) {
      if (x.status === '已计算') return alert('已计算的运营单不能修改，请先撤销计算');
      this.editing = x; this.form = { catId: x.catId, amount: x.amount, desc: x.desc, payMethod: x.payMethod || '' }; this.showForm = true;
    },
    save() {
      const f = this.form;
      if (!f.catId) return alert('请选择类目');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      if (this.editing) Object.assign(this.editing, { catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '' });
      else S.db.expenses.push({ id: S.genId(), catId: f.catId, amount: Number(f.amount), desc: f.desc, payMethod: f.payMethod || '', createTime: U.now(), status: '未计算' });
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
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <x-combobox v-model="q.catId" :options="catOpts" placeholder="全部类目"/>
      <x-combobox v-model="q.status" :options="statusOpts" placeholder="全部状态"/>
      <x-combobox v-model="q.payMethod" :options="payMethodOpts" placeholder="全部支付方式"/>
      <input v-model="q.desc" placeholder="详细描述模糊查询" style="width:180px">
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <span class="muted">已计算合计：￥{{fmtMoney(sumCalc)}}</span>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增运营单</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr><th>序号</th><th>类目名称</th><th class="num">金额</th><th>支付方式</th><th>详细描述</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="(x,i) in paged" :key="x.id">
          <td>{{(page-1)*pageSize+i+1}}</td><td>{{S.name('expenseCats',x.catId)}}</td>
          <td class="num money">{{fmtMoney(x.amount)}}</td><td>{{x.payMethod||'—'}}</td><td>{{x.desc||'-'}}</td>
          <td>{{x.createTime}}</td><td><x-status :v="x.status"/></td>
          <td class="ops">
            <template v-if="x.status==='未计算'">
              <span class="link" @click="openEdit(x)">修改</span>
              <span class="link danger" @click="del(x)">删除</span>
              <span class="link green" @click="calc(x)">计算</span>
            </template>
            <span v-else class="link warn" @click="uncalc(x)">撤销计算</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="8" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'修改运营单':'新增运营单'" :width="560" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>类目名称<b class="req">*</b></label>
          <x-combobox v-model="form.catId" :options="catOptsEnabled" placeholder="请选择"/></div>
        <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.amount"></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" placeholder="请选择"/></div>
        <div class="form-item full"><label>详细描述</label><textarea rows="2" v-model="form.desc"></textarea></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

Pages['page-finance'] = {
  components: { 'expense-list': ExpenseList },
  data() { return { tab: '日常运营' }; },
  template: `
  <div>
    <div class="page-title">财务管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['日常运营','类目管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <expense-list v-if="tab==='日常运营'"/>
      <dict-page v-else coll="expenseCats" label="类目名称"/>
    </div>
  </div>`
};
