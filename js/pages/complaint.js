/* 投诉管理：投诉管理 / 类型管理 */
window.Pages = window.Pages || {};

const ComplaintList = {
  data() {
    return {
      q: { typeId: '', cust: '', gp: '', rp: '', status: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}
    };
  },
  computed: {
    S() { return window.S; },
    qTypeOpts() { return [{ value: '', label: '全部类型' }].concat(S.db.complaintTypes.map(t => ({ value: t.id, label: t.name }))); },
    qStatusOpts() { return [{ value: '', label: '全部状态' }, { value: '未处理', label: '未处理' }, { value: '已处理', label: '已处理' }]; },
    formTypeOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('complaintTypes').map(t => ({ value: t.id, label: t.name }))); },
    formCustOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('customers').map(c => ({ value: c.id, label: c.name }))); },
    rows() {
      return S.db.complaints.filter(x =>
        (!this.q.typeId || x.typeId === this.q.typeId) &&
        U.kw(S.name('customers', x.customerId), this.q.cust) &&
        U.kw(x.regionPartnerId ? S.name('regionPartners', x.regionPartnerId) : '', this.q.gp) &&
        U.kw(this.resNames(x), this.q.rp) &&
        (!this.q.status || x.status === this.q.status) &&
        U.inRange(x.time, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    formCust() { return this.form.customerId ? S.byId('customers', this.form.customerId) : null; }
  },
  methods: {
    resNames(x) {
      return [x.r1, x.r2, x.r3].filter(Boolean).map(id => S.name('resourcePartners', id)).join('、');
    },
    openNew() {
      this.editing = null;
      this.form = { typeId: '', customerId: '', desc: '', time: U.now().slice(0, 16).replace(' ', 'T') };
      this.showForm = true;
    },
    openEdit(x) {
      this.editing = x;
      this.form = { typeId: x.typeId, customerId: x.customerId, desc: x.desc, time: (x.time || '').slice(0, 16).replace(' ', 'T') };
      this.showForm = true;
    },
    save() {
      const f = this.form;
      if (!f.typeId) return alert('请选择投诉类型');
      if (!f.customerId) return alert('请选择客户');
      if (!f.desc.trim()) return alert('请填写投诉描述');
      const cust = S.byId('customers', f.customerId);
      const time = (f.time || '').replace('T', ' ') + (f.time && f.time.length <= 16 ? ':00' : '');
      const data = {
        typeId: f.typeId, customerId: f.customerId, desc: f.desc.trim(), time: time || U.now(),
        regionPartnerId: cust ? cust.regionPartnerId : null,
        r1: cust ? cust.r1 : null, r2: cust ? cust.r2 : null, r3: cust ? cust.r3 : null
      };
      if (this.editing) Object.assign(this.editing, data);
      else S.db.complaints.push({ id: S.genId(), no: S.genNo('CO'), ...data, status: '未处理', createTime: U.now() });
      this.showForm = false;
    },
    del(x) {
      if (!U.confirm('确定删除投诉单 ' + x.no + ' 吗？')) return;
      S.db.complaints = S.db.complaints.filter(c => c.id !== x.id);
    },
    handle(x) {
      if (!U.confirm('确认已处理该投诉？')) return;
      x.status = '已处理';
    },
    exportData() {
      U.exportExcel('投诉记录.xlsx', this.rows.map((x, i) => ({
        '序号': i + 1, '投诉单号': x.no, '投诉类型': S.name('complaintTypes', x.typeId),
        '客户名称': S.name('customers', x.customerId),
        '区域合伙人': x.regionPartnerId ? S.name('regionPartners', x.regionPartnerId) : '',
        '资源合伙人': this.resNames(x), '投诉描述': x.desc, '投诉时间': x.time, '状态': x.status
      })));
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <x-combobox v-model="q.typeId" :options="qTypeOpts" style="width:110px"/>
      <input type="text" v-model="q.cust" placeholder="客户名称" style="width:110px">
      <input type="text" v-model="q.gp" placeholder="区域合伙人" style="width:100px">
      <input type="text" v-model="q.rp" placeholder="资源合伙人" style="width:100px">
      <x-combobox v-model="q.status" :options="qStatusOpts" style="width:100px"/>
      <input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增投诉单</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>投诉单</th><th>投诉类型</th><th>客户名称</th><th>区域合伙人</th><th>资源合伙人</th>
        <th>投诉描述</th><th>投诉时间</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(x,i) in paged" :key="x.id">
          <td>{{(page-1)*pageSize+i+1}}</td><td>{{x.no}}</td><td>{{S.name('complaintTypes',x.typeId)}}</td>
          <td>{{S.name('customers',x.customerId)}}</td>
          <td>{{x.regionPartnerId ? S.name('regionPartners',x.regionPartnerId) : '-'}}</td>
          <td>{{resNames(x)||'-'}}</td>
          <td style="max-width:220px;white-space:normal">{{x.desc}}</td>
          <td>{{x.time}}</td><td><x-status :v="x.status"/></td>
          <td class="ops">
            <span class="link" @click="openEdit(x)">修改</span>
            <span class="link danger" @click="del(x)">删除</span>
            <span v-if="x.status==='未处理'" class="link green" @click="handle(x)">处理</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="10" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'修改投诉单':'新增投诉单'" :width="640" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>投诉类型<b class="req">*</b></label>
          <x-combobox v-model="form.typeId" :options="formTypeOpts" style="width:100%"/></div>
        <div class="form-item"><label>客户名称<b class="req">*</b></label>
          <x-combobox v-model="form.customerId" :options="formCustOpts" style="width:100%"/></div>
        <div class="form-item"><label>区域合伙人（自动带出）</label>
          <input type="text" :value="formCust && formCust.regionPartnerId ? S.name('regionPartners',formCust.regionPartnerId) : ''" disabled></div>
        <div class="form-item"><label>资源合伙人（自动带出）</label>
          <input type="text" :value="formCust ? [formCust.r1,formCust.r2,formCust.r3].filter(Boolean).map(id=>S.name('resourcePartners',id)).join('、') : ''" disabled></div>
        <div class="form-item"><label>投诉时间</label><input type="datetime-local" v-model="form.time"></div>
        <div class="form-item full"><label>投诉描述<b class="req">*</b></label><textarea rows="3" v-model="form.desc"></textarea></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

Pages['page-complaint'] = {
  components: { 'complaint-list': ComplaintList },
  data() { return { tab: '投诉管理' }; },
  template: `
  <div>
    <div class="page-title">投诉管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['投诉管理','类型管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <complaint-list v-if="tab==='投诉管理'"/>
      <dict-page v-else coll="complaintTypes" label="投诉类型"/>
    </div>
  </div>`
};
