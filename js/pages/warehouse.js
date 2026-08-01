/* 仓库管理 */
window.Pages = window.Pages || {};

Pages['page-warehouse'] = {
  data() {
    return { kw: '', st: '', page: 1, pageSize: 10, showForm: false, editing: null, form: {} };
  },
  computed: {
    S() { return window.S; },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
    rows() {
      return S.db.warehouses.filter(w =>
        U.kw(w.name, this.kw) && (!this.st || w.status === this.st)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    daysLeft(w) { return w.expireDate ? U.daysBetween(U.today(), w.expireDate) : null; },
    openNew() {
      this.editing = null;
      this.form = { name: '', address: '', manager: '', phone: '', rent: null, expireDate: '', landlord: '' };
      this.showForm = true;
    },
    openEdit(w) { this.editing = w; this.form = { ...w }; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.name.trim()) return alert('请输入仓库名称');
      const data = {
        name: f.name.trim(), address: f.address, manager: f.manager, phone: f.phone,
        rent: Number(f.rent) || 0, expireDate: f.expireDate, landlord: f.landlord
      };
      if (this.editing) Object.assign(this.editing, data);
      else S.db.warehouses.push({ id: S.genId(), ...data, createTime: U.now(), status: '已启用' });
      this.showForm = false;
    },
    del(w) {
      if (S.usedBy('warehouses', w.id)) return alert('该仓库已有采购/库存/销售记录，无法删除，可改为停用');
      if (!U.confirm('确定删除仓库「' + w.name + '」吗？')) return;
      S.db.warehouses = S.db.warehouses.filter(x => x.id !== w.id);
    },
    toggle(w) { w.status = w.status === '已启用' ? '未启用' : '已启用'; }
  },
  template: `
  <div>
    <div class="page-title">仓库管理</div>
    <div class="card">
      <div class="toolbar">
        <input type="text" v-model="kw" placeholder="仓库名称模糊查询">
        <x-combobox v-model="st" :options="statusOpts" style="width:120px"/>
        <div class="spacer"></div>
        <button class="btn btn-primary" @click="openNew">+ 新增仓库</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>仓库名称</th><th>仓库地址</th><th>负责人</th><th>联系电话</th>
          <th class="num">每月租金</th><th>到期时间</th><th>房东/联系电话</th><th>创建时间</th><th>状态</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(w,i) in paged" :key="w.id">
            <td>{{(page-1)*pageSize+i+1}}</td><td>{{w.name}}</td><td>{{w.address}}</td><td>{{w.manager}}</td><td>{{w.phone}}</td>
            <td class="num money">{{fmtMoney(w.rent)}}</td>
            <td>{{w.expireDate||'-'}} <span v-if="daysLeft(w)!==null"><span v-if="daysLeft(w)<=60" class="tag" :class="daysLeft(w)<=30?'tag-red':'tag-orange'">{{daysLeft(w)<0?'已到期':'剩'+daysLeft(w)+'天'}}</span></span></td>
            <td>{{w.landlord||'-'}}</td><td>{{w.createTime}}</td>
            <td><x-status :v="w.status"/></td>
            <td class="ops">
              <span class="link" @click="openEdit(w)">编辑</span>
              <span class="link danger" @click="del(w)">删除</span>
              <span class="link" :class="w.status==='已启用'?'warn':'green'" @click="toggle(w)">{{w.status==='已启用'?'停用':'启用'}}</span>
            </td>
          </tr>
          <tr v-if="!paged.length"><td colspan="11" class="empty">暂无数据</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <x-modal v-if="showForm" :title="editing?'编辑仓库':'新增仓库'" :width="640" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>仓库名称<b class="req">*</b></label><input type="text" v-model="form.name"></div>
        <div class="form-item"><label>负责人</label><input type="text" v-model="form.manager"></div>
        <div class="form-item"><label>联系电话</label><input type="text" v-model="form.phone"></div>
        <div class="form-item"><label>每月租金（元）</label><input type="number" min="0" v-model.number="form.rent"></div>
        <div class="form-item"><label>到期时间</label><input type="date" v-model="form.expireDate"></div>
        <div class="form-item"><label>房东/联系电话</label><input type="text" v-model="form.landlord" placeholder="如：罗先生/13600001111"></div>
        <div class="form-item full"><label>仓库地址</label><input type="text" v-model="form.address"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};
