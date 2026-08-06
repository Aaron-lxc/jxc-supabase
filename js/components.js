/* 通用组件 */
window.AppComponents = {};

/* 弹窗 */
AppComponents['x-modal'] = {
  props: ['title', 'width', 'fullscreen', 'position'],  /* fullscreen:Boolean  position:'center'|'bottom' */
  emits: ['close'],
  computed: {
    boxStyle() {
      if (this.fullscreen) return {};
      if (this.position === 'bottom') return { width: '100%', maxWidth: '100%' };
      return { width: (this.width || 640) + 'px' };
    }
  },
  template: `
  <div class="modal-mask" @mousedown.self="$emit('close')">
    <div class="modal-box" :class="[{'fs':fullscreen,'sheet':position==='bottom'}]" :style="boxStyle">
      <div class="modal-head"><span>{{title}}</span><button class="btn-x" @click="$emit('close')">×</button></div>
      <div class="modal-body"><slot></slot></div>
      <div class="modal-foot"><slot name="foot"></slot></div>
    </div>
  </div>`
};

/* 右侧滑入详情抽屉（行详情，手机端为主） */
AppComponents['x-drawer'] = {
  props: { title: String, fields: { type: Array, default: () => [] }, open: Boolean },
  emits: ['close'],
  template: `
  <div class="drawer-mask" v-if="open" @click.self="$emit('close')">
    <div class="drawer-panel">
      <div class="drawer-head"><span>{{title}}</span><button class="btn-x" @click="$emit('close')">×</button></div>
      <div class="drawer-body">
        <div class="kv-grid">
          <div v-for="(f,i) in fields" :key="i" :class="{full: f.full}">
            <label>{{f.label}}</label><span>{{f.value}}</span>
          </div>
        </div>
        <div class="drawer-foot"><button class="btn btn-primary" style="width:100%" @click="$emit('close')">关闭</button></div>
      </div>
    </div>
  </div>`
};

/* 分页（支持每页条数 10/20/30/50/100 切换） */
AppComponents['x-pager'] = {
  props: { total: Number, page: Number, size: { type: Number, default: 10 } },
  emits: ['update:page', 'update:size'],
  data() { return { sizes: [10, 20, 30, 50, 100] }; },
  computed: {
    pages() { return Math.max(1, Math.ceil((this.total || 0) / this.size)); }
  },
  watch: {
    pages(v) { if (this.page > v) this.$emit('update:page', v); }
  },
  methods: {
    setSize(v) { const n = Number(v); if (n !== this.size) this.$emit('update:size', n); }
  },
  template: `
  <div class="pager" v-if="total > 0">
    <span>共 {{total}} 条 / {{pages}} 页</span>
    <label class="pg-size">每页
      <select class="pg-select" :value="size" @change="setSize($event.target.value)">
        <option v-for="n in sizes" :key="n" :value="n">{{n}} 条</option>
      </select>
    </label>
    <button class="pg-first" :disabled="page<=1" @click="$emit('update:page', 1)">首页</button>
    <button :disabled="page<=1" @click="$emit('update:page', page-1)">上一页</button>
    <button class="cur">{{page}}</button>
    <button :disabled="page>=pages" @click="$emit('update:page', page+1)">下一页</button>
    <button class="pg-last" :disabled="page>=pages" @click="$emit('update:page', pages)">末页</button>
  </div>`
};

/* 状态标签 */
AppComponents['x-status'] = {
  props: ['v'],
  computed: {
    cls() {
      return ({
        '已启用': 'tag-green', '已完成': 'tag-green', '已支付': 'tag-green', '已处理': 'tag-green', '已计算': 'tag-green',
        '未启用': 'tag-gray', '未完成': 'tag-blue', '未支付': 'tag-red', '未处理': 'tag-orange', '未计算': 'tag-orange'
      })[this.v] || 'tag-gray';
    }
  },
  template: `<span class="tag" :class="cls">{{v}}</span>`
};

/* 通用字典管理页（商品类型/单位/供应商/客户级别/客户类型/区域/投诉类型/财务类目） */
AppComponents['dict-page'] = {
  props: {
    coll: String,       /* 集合名 */
    label: String,       /* 名称列标题，如"商品类型" */
    title: String       /* 页面标题 */
  },
  data() {
    return { kw: '', st: '', page: 1, pageSize: 10, showForm: false, editing: null, formName: '' };
  },
  computed: {
    S() { return window.S; },
    statusOpts() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
    rows() {
      return (S.db[this.coll] || []).filter(r =>
        U.kw(r.name, this.kw) && (!this.st || r.status === this.st)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); }
  },
  methods: {
    openNew() { this.editing = null; this.formName = ''; this.showForm = true; },
    openEdit(r) { this.editing = r; this.formName = r.name; this.showForm = true; },
    save() {
      const name = this.formName.trim();
      if (!name) return alert('请输入' + this.label);
      const dup = (S.db[this.coll] || []).some(r => r.name === name && (!this.editing || r.id !== this.editing.id));
      if (dup) return alert(this.label + '「' + name + '」已存在');
      if (this.editing) { this.editing.name = name; }
      else { S.db[this.coll].push({ id: S.genId(), name, createTime: U.now(), status: '已启用' }); }
      this.showForm = false;
    },
    del(r) {
      if (S.usedBy(this.coll, r.id)) return alert('「' + r.name + '」已被其他数据引用，无法删除，可改为停用');
      if (!U.confirm('确定删除「' + r.name + '」吗？')) return;
      S.db[this.coll] = S.db[this.coll].filter(x => x.id !== r.id);
    },
    toggle(r) { r.status = r.status === '已启用' ? '未启用' : '已启用'; }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="kw" :placeholder="label+'模糊查询'">
      <x-combobox v-model="st" :options="statusOpts" style="width:120px"/>
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openNew">+ 新增{{label}}</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr><th>序号</th><th>{{label}}</th><th>创建时间</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>
        <tr v-for="(r,i) in paged" :key="r.id">
          <td><span class="cell-label">序号</span>{{(page-1)*pageSize+i+1}}</td>
          <td><span class="cell-label">{{label}}</span>{{r.name}}</td>
          <td><span class="cell-label">创建时间</span>{{r.createTime}}</td>
          <td><span class="cell-label">状态</span><x-status :v="r.status"/></td>
          <td class="ops">
            <span class="link" @click="openEdit(r)">修改</span>
            <span class="link danger" @click="del(r)">删除</span>
            <span class="link" :class="r.status==='已启用'?'warn':'green'" @click="toggle(r)">{{r.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="5" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    <x-modal v-if="showForm" :title="(editing?'修改':'新增')+label" :width="560" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-item">
        <label>{{label}}<b class="req">*</b></label>
        <input type="text" v-model="formName" @keyup.enter="save">
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

/* 通用模糊检索下拉（替代原生 select，支持输入过滤，全站通用） */
AppComponents['x-combobox'] = {
  props: {
    modelValue: { default: '' },
    options: { type: Array, default: () => [] },   /* [{value,label}] 或 [string] */
    placeholder: { type: String, default: '请选择' },
    disabled: Boolean
  },
  emits: ['update:modelValue'],
  data() { return { open: false, kw: '', pos: { top: 0, left: 0, width: 0 } }; },
  computed: {
    norm() {
      return (this.options || []).map(o =>
        (o && typeof o === 'object') ? { value: o.value, label: String(o.label != null ? o.label : o.value) }
          : { value: o, label: String(o) });
    },
    filtered() {
      const k = (this.kw || '').trim();
      if (!k) return this.norm;
      return this.norm.filter(o => U.kw(o.label, k));
    },
    labelOf() {
      const o = this.norm.find(x => x.value === this.modelValue);
      return o ? o.label : (this.modelValue === '' || this.modelValue == null ? '' : String(this.modelValue));
    }
  },
  methods: {
    updatePos() {
      const el = this.$el && this.$el.querySelector ? this.$el.querySelector('.cb-input') : null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      this.pos = { top: Math.round(r.bottom) + 2, left: Math.round(r.left), width: Math.round(r.width) };
    },
    onScroll() { if (this.open) this.updatePos(); },
    onResize() { if (this.open) this.updatePos(); },
    cleanup() {
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('resize', this.onResize);
    },
    onFocus() {
      if (this.disabled) return;
      this.open = true; this.kw = '';
      this.$nextTick(() => this.updatePos());
      window.addEventListener('scroll', this.onScroll, true);
      window.addEventListener('resize', this.onResize);
    },
    onInput(e) { this.kw = e.target.value; this.open = true; this.$nextTick(() => this.updatePos()); },
    toggle() {
      if (this.disabled) return;
      this.open = !this.open; this.kw = '';
      if (this.open) this.$nextTick(() => this.updatePos()); else this.cleanup();
    },
    pick(o) { this.$emit('update:modelValue', o.value); this.open = false; this.kw = ''; this.cleanup(); },
    onBlur() { setTimeout(() => { this.open = false; this.cleanup(); }, 120); }
  },
  template: `
  <div class="x-combobox" :class="{open:open, disabled}">
    <div class="cb-control">
      <input class="cb-input" :value="open ? kw : labelOf" @focus="onFocus" @input="onInput" @blur="onBlur"
        :placeholder="placeholder" :disabled="disabled">
      <span class="cb-arrow" @mousedown.prevent="toggle">▾</span>
    </div>
    <teleport to="body">
    <div class="cb-panel" v-if="open" :style="{top:pos.top+'px',left:pos.left+'px',minWidth:pos.width+'px'}">
      <div class="cb-opt" v-for="o in filtered" :key="(o.value===null||o.value==='')?'_all':o.value"
        :class="{sel:o.value===modelValue}" @mousedown.prevent="pick(o)">{{o.label}}</div>
      <div class="cb-empty" v-if="!filtered.length">无匹配项</div>
    </div>
    </teleport>
  </div>`
};
