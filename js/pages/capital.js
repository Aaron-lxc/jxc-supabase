/* 注资管理：股东向企业注入资金（与合伙人无关，纯自由股东名称）。
   汇总：各股东累计注资、总注资额。 */
window.Pages = window.Pages || {};

Pages['page-capital'] = {
  data() {
    return {
      q: { investor: '' }, page: 1, pageSize: 10, showForm: false,
      form: { investor: '', method: '', amount: null, date: U.today(), remark: '' }
    };
  },
  computed: {
    S() { return window.S; },
    P() { return window.P; },
    ro() { return !P.canEdit('capital'); },
    methodOpts() { return window.PAY_METHODS.map(m => ({ value: m, label: m })); },
    rows() {
      return S.db.capitalInjections
        .filter(x => U.kw(x.investor, this.q.investor))
        .slice().sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    total() { return S.totalCapitalInjected(); },
    byInvestor() { return S.capitalByInvestor(); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    openNew() { this.form = { investor: '', method: '', amount: null, date: U.today(), remark: '' }; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.investor || !f.investor.trim()) return alert('请填写股东名称');
      if (!f.method) return alert('请选择支付方式');
      if (!f.amount || f.amount <= 0) return alert('请填写金额');
      S.addCapitalInjection({ investor: f.investor.trim(), method: f.method, amount: f.amount, date: f.date, remark: f.remark });
      this.showForm = false;
    },
    del(r) {
      if (!U.confirm('确定删除该笔注资记录吗？')) return;
      S.delCapitalInjection(r.id);
    },
    exportData() {
      U.exportExcel('股东注资明细.xlsx', this.rows.map((x, i) => ({
        '序号': i + 1, '编号': x.no, '股东名称': x.investor, '支付方式': x.method,
        '金额': x.amount, '日期': x.date, '备注': x.remark, '操作人': x.operator, '录入时间': x.createTime
      })));
    }
  },
  template: `
  <div>
    <div class="page-title">注资管理
      <span class="muted" style="font-size:13px;font-weight:400;margin-left:8px">股东注资（与合伙人无关），作为企业权益与净资产来源</span>
    </div>

    <div class="stat-grid" style="margin-bottom:14px">
      <div class="stat-card c2"><div class="t">注资总额</div><div class="v money">￥{{fmtMoney(total)}}</div>
        <div class="sub">累计股东注入资金</div></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <input type="text" v-model="q.investor" placeholder="股东名称模糊查询" style="width:160px">
        <div class="spacer"></div>
        <span class="muted">注资笔数 {{rows.length}} 笔</span>
        <button class="btn" @click="exportData">导出</button>
        <button class="btn btn-primary" :disabled="ro" @click="openNew">+ 新增注资</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr><th>序号</th><th>编号</th><th>股东名称</th><th>支付方式</th><th class="num">金额</th><th>日期</th><th>备注</th><th>操作人</th><th v-if="!ro">操作</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged"><td data-label="序号">{{(page-1)*pageSize+i+1}}</td><td data-label="编号">{{r.no}}</td>
            <td data-label="股东名称">{{r.investor}}</td><td data-label="支付方式">{{r.method||'-'}}</td>
            <td class="num money" data-label="金额">{{fmtMoney(r.amount)}}</td><td data-label="日期">{{r.date}}</td>
            <td data-label="备注">{{r.remark||'-'}}</td><td data-label="操作人">{{r.operator||'-'}}</td>
            <td v-if="!ro" class="ops" data-label="操作"><span class="link danger" @click="del(r)">删除</span></td></tr>
          <tr v-if="!paged.length"><td colspan="9" class="empty">暂无注资记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <div class="card" style="margin-top:14px">
      <h3>各股东累计注资</h3>
      <table class="grid">
        <thead><tr><th>序号</th><th>股东名称</th><th class="num">累计注资</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in byInvestor"><td data-label="序号">{{i+1}}</td><td data-label="股东名称">{{r.investor}}</td><td class="num money" data-label="累计注资">{{fmtMoney(r.amount)}}</td></tr>
          <tr v-if="!byInvestor.length"><td colspan="3" class="empty">暂无注资</td></tr>
        </tbody>
      </table>
    </div>

    <x-modal v-if="showForm" title="新增股东注资" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>股东名称<b class="req">*</b></label><input type="text" v-model="form.investor" placeholder="如：股东张三 / 公司增资"></div>
        <div class="form-item"><label>支付方式<b class="req">*</b></label><x-combobox v-model="form.method" :options="methodOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>金额（元）<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.amount"></div>
        <div class="form-item"><label>日期</label><input type="date" v-model="form.date"></div>
        <div class="form-item full"><label>备注</label><input type="text" v-model="form.remark" placeholder="选填"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};
