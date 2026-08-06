/* 佣金管理：资源佣金比例 / 区域佣金比例 */
window.Pages = window.Pages || {};

const ResourceRates = {
  data() { return { showForm: false, editing: null, form: {} }; },
  computed: {
    S() { return window.S; },
    levelOpts() { return [{ value: 1, label: '一级' }, { value: 2, label: '二级' }, { value: 3, label: '三级' }]; },
    rows() { return S.db.resourceRates.slice().sort((a, b) => a.level - b.level); }
  },
  methods: {
    lvName(L) { return ['一级', '二级', '三级'][L - 1]; },
    openNew() { this.editing = null; this.form = { level: 1, rate: null }; this.showForm = true; },
    openEdit(r) { this.editing = r; this.form = { level: r.level, rate: r.rate }; this.showForm = true; },
    save() {
      const f = this.form;
      if (f.rate == null || f.rate < 0 || f.rate > 100) return alert('请填写 0-100 之间的佣金比例');
      if (this.editing) { this.editing.level = f.level; this.editing.rate = Number(f.rate); this.enforce(this.editing); }
      else {
        const rec = { id: S.genId(), level: f.level, rate: Number(f.rate), createTime: U.now(), status: '已启用' };
        S.db.resourceRates.push(rec);
        this.enforce(rec);
      }
      this.showForm = false;
    },
    enforce(rec) { /* 同一级别仅一条启用 */
      if (rec.status !== '已启用') return;
      S.db.resourceRates.forEach(x => { if (x.id !== rec.id && x.level === rec.level && x.status === '已启用') x.status = '未启用'; });
    },
    del(r) {
      if (!U.confirm('确定删除该佣金比例吗？')) return;
      S.db.resourceRates = S.db.resourceRates.filter(x => x.id !== r.id);
    },
    toggle(r) {
      r.status = r.status === '已启用' ? '未启用' : '已启用';
      this.enforce(r);
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <div class="muted">佣金 = 名下客户已完成销售净额 × 比例；同一级别只允许一条「已启用」比例，启用新比例会自动停用旧比例。</div>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openNew">+ 新增资源佣金比例</button>
    </div>
    <table class="grid">
      <thead><tr><th>序号</th><th>资源级别</th><th class="num">佣金比例</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="(r,i) in rows" :key="r.id">
          <td data-label="序号">{{i+1}}</td><td data-label="资源级别">{{lvName(r.level)}}</td><td class="num" data-label="佣金比例">{{r.rate}}%</td><td data-label="创建时间">{{r.createTime}}</td>
          <td data-label="状态"><x-status :v="r.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="openEdit(r)">修改</span>
            <span class="link danger" @click="del(r)">删除</span>
            <span class="link" :class="r.status==='已启用'?'warn':'green'" @click="toggle(r)">{{r.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="6" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    <x-modal v-if="showForm" :title="editing?'修改资源佣金比例':'新增资源佣金比例'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>资源级别<b class="req">*</b></label>
          <x-combobox v-model="form.level" :options="levelOpts" style="width:100%"/></div>
        <div class="form-item"><label>佣金比例（%）<b class="req">*</b></label><input type="number" min="0" max="100" step="0.1" v-model.number="form.rate"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

const RegionRates = {
  data() { return { showForm: false, editing: null, form: {} }; },
  computed: {
    S() { return window.S; },
    formPartnerOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('regionPartners').map(p => ({ value: p.id, label: p.name }))); },
    rows() { return S.db.regionRates.slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || '')); }
  },
  methods: {
    openNew() { this.editing = null; this.form = { partnerId: '', rate: null }; this.showForm = true; },
    openEdit(r) { this.editing = r; this.form = { partnerId: r.partnerId, rate: r.rate }; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.partnerId) return alert('请选择区域合伙人');
      if (f.rate == null || f.rate < 0 || f.rate > 100) return alert('请填写 0-100 之间的佣金比例');
      if (this.editing) { this.editing.partnerId = f.partnerId; this.editing.rate = Number(f.rate); this.enforce(this.editing); }
      else {
        const rec = { id: S.genId(), partnerId: f.partnerId, rate: Number(f.rate), createTime: U.now(), status: '已启用' };
        S.db.regionRates.push(rec);
        this.enforce(rec);
      }
      this.showForm = false;
    },
    enforce(rec) { /* 同一合伙人仅一条启用 */
      if (rec.status !== '已启用') return;
      S.db.regionRates.forEach(x => { if (x.id !== rec.id && x.partnerId === rec.partnerId && x.status === '已启用') x.status = '未启用'; });
    },
    del(r) {
      if (!U.confirm('确定删除该佣金比例吗？')) return;
      S.db.regionRates = S.db.regionRates.filter(x => x.id !== r.id);
    },
    toggle(r) { r.status = r.status === '已启用' ? '未启用' : '已启用'; this.enforce(r); }
  },
  template: `
  <div>
    <div class="toolbar">
      <div class="muted">区域佣金 = 该区域合伙人名下客户已完成销售净额 × 比例；同一合伙人只允许一条「已启用」比例。</div>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openNew">+ 新增区域佣金比例</button>
    </div>
    <table class="grid">
      <thead><tr><th>序号</th><th>区域合伙人</th><th class="num">佣金比例</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="(r,i) in rows" :key="r.id">
          <td data-label="序号">{{i+1}}</td><td data-label="区域合伙人">{{S.name('regionPartners',r.partnerId)}}</td><td class="num" data-label="佣金比例">{{r.rate}}%</td><td data-label="创建时间">{{r.createTime}}</td>
          <td data-label="状态"><x-status :v="r.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="openEdit(r)">修改</span>
            <span class="link danger" @click="del(r)">删除</span>
            <span class="link" :class="r.status==='已启用'?'warn':'green'" @click="toggle(r)">{{r.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!rows.length"><td colspan="6" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    <x-modal v-if="showForm" :title="editing?'修改区域佣金比例':'新增区域佣金比例'" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>区域合伙人<b class="req">*</b></label>
          <x-combobox v-model="form.partnerId" :options="formPartnerOpts" style="width:100%"/></div>
        <div class="form-item"><label>佣金比例（%）<b class="req">*</b></label><input type="number" min="0" max="100" step="0.1" v-model.number="form.rate"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

Pages['page-commission'] = {
  components: { 'resource-rates': ResourceRates, 'region-rates': RegionRates },
  data() { return { tab: '资源佣金比例' }; },
  template: `
  <div>
    <div class="page-title">佣金管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['资源佣金比例','区域佣金比例']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <resource-rates v-if="tab==='资源佣金比例'"/>
      <region-rates v-else/>
    </div>
  </div>`
};
