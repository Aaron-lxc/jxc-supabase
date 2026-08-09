/* 商品管理：商品管理 / 商品类型 / 单位管理 / 供应商管理 */
window.Pages = window.Pages || {};

const GoodsList = {
  data() {
    return {
      q: { name: '', typeId: '', status: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null,
      form: {}
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.goods.filter(g =>
        U.kw(g.name, this.q.name) &&
        (!this.q.typeId || g.typeId === this.q.typeId) &&
        (!this.q.status || g.status === this.q.status) &&
        U.inRange(g.createTime, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    typeOptsAll() { return [{ value: '', label: '全部类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    statusOptsAll() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
    typeOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('goodsTypes').map(t => ({ value: t.id, label: t.name }))); },
    unitOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('units').map(t => ({ value: t.id, label: t.name }))); },
    supplierOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('suppliers').map(t => ({ value: t.id, label: t.name }))); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    rowFields(g) {
      return [
        { label: '商品编号', value: g.code },
        { label: '商品名称', value: g.name },
        { label: '商品类型', value: S.name('goodsTypes', g.typeId) },
        { label: 'SKU', value: g.sku || '-' },
        { label: '单位', value: S.name('units', g.unitId) },
        { label: '供应商', value: S.name('suppliers', g.supplierId) },
        { label: '采购价', value: U.fmtMoney(g.purchasePrice) },
        { label: '零售价', value: U.fmtMoney(g.retailPrice) },
        { label: '大客价', value: U.fmtMoney(g.bigPrice) },
        { label: '批发价', value: U.fmtMoney(g.wholePrice) },
        { label: '最低库存', value: g.minStock },
        { label: '保质期(天)', value: g.shelfLife ? g.shelfLife + ' 天' : '永不过期' },
        { label: '临期提醒(天)', value: g.expireWarn ? '提前 ' + g.expireWarn + ' 天' : '不提醒' },
        { label: '创建时间', value: g.createTime },
        { label: '状态', value: g.status }
      ];
    },
    blank() {
      return { name: '', typeId: '', sku: '', unitId: '', supplierId: '', purchasePrice: null, retailPrice: null, bigPrice: null, wholePrice: null, minStock: 0, shelfLife: 0, expireWarn: 0 };
    },
    openNew() { this.editing = null; this.form = this.blank(); this.showForm = true; },
    openEdit(g) { this.editing = g; this.form = { ...g }; this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.name.trim()) return alert('请输入商品名称');
      if (!f.typeId) return alert('请选择商品类型');
      if (!f.unitId) return alert('请选择商品单位');
      if (!f.supplierId) return alert('请选择供应商');
      if (f.purchasePrice == null || f.retailPrice == null) return alert('请填写采购价与零售价');
      if (this.editing) {
        Object.assign(this.editing, {
          name: f.name.trim(), typeId: f.typeId, sku: f.sku, unitId: f.unitId, supplierId: f.supplierId,
          purchasePrice: Number(f.purchasePrice), retailPrice: Number(f.retailPrice),
          bigPrice: Number(f.bigPrice) || Number(f.retailPrice), wholePrice: Number(f.wholePrice) || Number(f.retailPrice),
          minStock: Number(f.minStock) || 0, shelfLife: Number(f.shelfLife) || 0, expireWarn: Number(f.expireWarn) || 0
        });
      } else {
        S.db.goods.push({
          id: S.genId(), code: S.genCode('GD'), name: f.name.trim(), typeId: f.typeId, sku: f.sku,
          unitId: f.unitId, supplierId: f.supplierId,
          purchasePrice: Number(f.purchasePrice), retailPrice: Number(f.retailPrice),
          bigPrice: Number(f.bigPrice) || Number(f.retailPrice), wholePrice: Number(f.wholePrice) || Number(f.retailPrice),
          minStock: Number(f.minStock) || 0, shelfLife: Number(f.shelfLife) || 0, expireWarn: Number(f.expireWarn) || 0, createTime: U.now(), status: '已启用'
        });
      }
      this.showForm = false;
    },
    del(g) {
      if (S.usedBy('goods', g.id)) return alert('该商品已有采购/销售/库存记录，无法删除，可改为停用');
      if (!U.confirm('确定删除商品「' + g.name + '」吗？')) return;
      S.db.goods = S.db.goods.filter(x => x.id !== g.id);
    },
    toggle(g) { g.status = g.status === '已启用' ? '未启用' : '已启用'; }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.name" placeholder="商品名称模糊查询">
      <x-combobox v-model="q.typeId" :options="typeOptsAll" placeholder="全部类型"/>
      <x-combobox v-model="q.status" :options="statusOptsAll" placeholder="全部状态"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <button class="btn btn-primary" @click="openNew">+ 新增商品</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>商品编号</th><th>商品名称</th><th>商品类型</th><th>SKU</th><th>单位</th><th>供应商</th>
        <th class="num">采购价</th><th class="num">零售价</th><th class="num">大客价</th><th class="num">批发价</th>
        <th class="num">最低库存</th><th>创建时间</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="g in paged" :key="g.id">
          <td data-label="商品编号">{{g.code}}</td>
          <td data-label="商品名称">{{g.name}}</td>
          <td data-label="商品类型">{{S.name('goodsTypes',g.typeId)}}</td>
          <td data-label="SKU">{{g.sku}}</td>
          <td data-label="单位">{{S.name('units',g.unitId)}}</td>
          <td data-label="供应商">{{S.name('suppliers',g.supplierId)}}</td>
          <td class="num money" data-label="采购价">{{fmtMoney(g.purchasePrice)}}</td>
          <td class="num money" data-label="零售价">{{fmtMoney(g.retailPrice)}}</td>
          <td class="num money" data-label="大客价">{{fmtMoney(g.bigPrice)}}</td>
          <td class="num money" data-label="批发价">{{fmtMoney(g.wholePrice)}}</td>
          <td class="num" data-label="最低库存">{{g.minStock}}</td>
          <td data-label="创建时间">{{g.createTime}}</td>
          <td data-label="状态"><x-status :v="g.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="openEdit(g)">编辑</span>
            <span class="link danger" @click="del(g)">删除</span>
            <span class="link" :class="g.status==='已启用'?'warn':'green'" @click="toggle(g)">{{g.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="14" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'编辑商品':'新增商品'" :width="640" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>商品名称<b class="req">*</b></label><input type="text" v-model="form.name"></div>
        <div class="form-item"><label>商品类型<b class="req">*</b></label>
          <x-combobox v-model="form.typeId" :options="typeOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>SKU</label><input type="text" v-model="form.sku"></div>
        <div class="form-item"><label>商品单位<b class="req">*</b></label>
          <x-combobox v-model="form.unitId" :options="unitOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>供应商<b class="req">*</b></label>
          <x-combobox v-model="form.supplierId" :options="supplierOpts" placeholder="请选择（可输入检索）"/></div>
        <div class="form-item"><label>最低库存</label><input type="number" min="0" v-model.number="form.minStock"></div>
        <div class="form-item"><label>保质期(天)</label><input type="number" min="0" v-model.number="form.shelfLife" placeholder="0=永不过期"></div>
        <div class="form-item"><label>临期提醒(天)</label><input type="number" min="0" v-model.number="form.expireWarn" placeholder="0=不提醒"></div>
        <div class="form-item"><label>采购价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.purchasePrice"></div>
        <div class="form-item"><label>零售价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="form.retailPrice"></div>
        <div class="form-item"><label>大客价</label><input type="number" min="0" step="0.01" v-model.number="form.bigPrice"></div>
        <div class="form-item"><label>批发价</label><input type="number" min="0" step="0.01" v-model.number="form.wholePrice"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>
  </div>`
};

/* ---------------- 供应商管理（富字段） ---------------- */
const PAY_CYCLES = ['现结', '货到付款'];
const PAY_METHODS = window.PAY_METHODS || ['对公', '微信', '收款码', '银行卡'];

const SupplierList = {
  data() {
    return {
      q: { name: '', contact: '', payCycle: '', payMethod: '', status: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}, detail: null
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.suppliers.filter(s =>
        U.kw(s.name, this.q.name) &&
        U.kw((s.contactBiz || '') + (s.contactBizWechat || '') + (s.contactFin || '') + (s.contactFinWechat || ''), this.q.contact) &&
        (!this.q.payCycle || s.payCycle === this.q.payCycle) &&
        (!this.q.payMethod || s.payMethod === this.q.payMethod) &&
        (!this.q.status || s.status === this.q.status)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    cycleOptsAll() { return [{ value: '', label: '全部支付周期' }].concat(PAY_CYCLES.map(x => ({ value: x, label: x }))); },
    methodOptsAll() { return [{ value: '', label: '全部支付方式' }].concat(PAY_METHODS.map(x => ({ value: x, label: x }))); },
    statusOptsAll() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
    cycleOpts() { return PAY_CYCLES.map(x => ({ value: x, label: x })); },
    methodOpts() { return [{ value: '', label: '请选择' }].concat(PAY_METHODS.map(x => ({ value: x, label: x }))); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    rowFields(s) {
      return [
        { label: '供应商名称', value: s.name },
        { label: '地址', value: s.address || '-' },
        { label: '业务联系人', value: s.contactBiz || '-' },
        { label: '业务微信', value: s.contactBizWechat || '-' },
        { label: '财务联系人', value: s.contactFin || '-' },
        { label: '财务微信', value: s.contactFinWechat || '-' },
        { label: '支付周期', value: s.payCycle || '-' },
        { label: '支付方式', value: s.payMethod || '-' },
        { label: '开票税点', value: (s.taxPoint || 0) + '%' },
        { label: '在售商品数', value: this.goodsCount(s) },
        { label: '累计采购金额', value: U.fmtMoney(this.purchaseAmt(s)) },
        { label: '创建时间', value: s.createTime },
        { label: '状态', value: s.status }
      ];
    },
    goodsCount(s) { return S.db.goods.filter(g => g.supplierId === s.id).length; },
    purchaseAmt(s) {
      return U.round2(S.db.purchases.filter(p => p.supplierId === s.id).reduce((a, p) => a + Number(p.amount || 0), 0));
    },
    blank() {
      return {
        name: '', address: '', contactBiz: '', contactBizWechat: '', contactFin: '', contactFinWechat: '',
        payCycle: '现结', payMethod: '对公', taxPoint: 0, remark: ''
      };
    },
    openNew() { this.editing = null; this.form = this.blank(); this.showForm = true; },
    openEdit(s) { this.editing = s; this.form = Object.assign(this.blank(), s); this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.name || !f.name.trim()) return alert('请输入供应商名称');
      const dup = S.db.suppliers.some(x => x.name === f.name.trim() && (!this.editing || x.id !== this.editing.id));
      if (dup) return alert('供应商名称已存在');
      const data = {
        name: f.name.trim(), address: f.address || '',
        contactBiz: f.contactBiz || '', contactBizWechat: f.contactBizWechat || '',
        contactFin: f.contactFin || '', contactFinWechat: f.contactFinWechat || '',
        payCycle: f.payCycle || '现结', payMethod: f.payMethod || '对公',
        taxPoint: Number(f.taxPoint) || 0, remark: f.remark || ''
      };
      if (this.editing) Object.assign(this.editing, data);
      else S.db.suppliers.push(Object.assign({ id: S.genId(), createTime: U.now(), status: '已启用' }, data));
      this.showForm = false;
    },
    del(s) {
      if (S.usedBy('suppliers', s.id)) return alert('该供应商已被商品或采购单引用，无法删除，可改为停用');
      if (!U.confirm('确定删除供应商「' + s.name + '」吗？')) return;
      S.db.suppliers = S.db.suppliers.filter(x => x.id !== s.id);
    },
    toggle(s) { s.status = s.status === '已启用' ? '未启用' : '已启用'; },
    exportData() {
      U.exportExcel('供应商台账.xlsx', this.rows.map((s, i) => ({
        '序号': i + 1, '供应商名称': s.name, '地址': s.address || '',
        '业务联系人': s.contactBiz || '', '业务微信': s.contactBizWechat || '',
        '财务联系人': s.contactFin || '', '财务微信': s.contactFinWechat || '',
        '支付周期': s.payCycle || '', '支付方式': s.payMethod || '', '开票税点(%)': s.taxPoint || 0,
        '在售商品数': this.goodsCount(s), '累计采购金额': this.purchaseAmt(s),
        '创建时间': s.createTime, '状态': s.status
      })));
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.name" placeholder="供应商名称模糊查询" style="width:150px">
      <input type="text" v-model="q.contact" placeholder="联系人/电话/微信" style="width:150px">
      <x-combobox v-model="q.payCycle" :options="cycleOptsAll" placeholder="全部支付周期"/>
      <x-combobox v-model="q.payMethod" :options="methodOptsAll" placeholder="全部支付方式"/>
      <x-combobox v-model="q.status" :options="statusOptsAll" placeholder="全部状态"/>
      <div class="spacer"></div>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增供应商</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>供应商名称</th><th>地址</th><th>业务联系人 / 电话或微信</th><th>财务联系人 / 电话或微信</th>
        <th>支付周期</th><th>支付方式</th><th class="num">开票税点</th><th class="num">在售商品</th><th class="num">累计采购</th>
        <th>创建时间</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="(s,i) in paged" :key="s.id">
          <td data-label="序号">{{(page-1)*pageSize+i+1}}</td>
          <td data-label="供应商名称"><span class="link" @click="detail=s">{{s.name}}</span></td>
          <td data-label="地址">{{s.address||'-'}}</td>
          <td data-label="业务联系人 / 电话或微信">{{s.contactBiz||'-'}}<span v-if="s.contactBizWechat" class="muted"> / 微信 {{s.contactBizWechat}}</span></td>
          <td data-label="财务联系人 / 电话或微信">{{s.contactFin||'-'}}<span v-if="s.contactFinWechat" class="muted"> / 微信 {{s.contactFinWechat}}</span></td>
          <td data-label="支付周期"><span class="tag" :class="s.payCycle==='现结'?'tag-green':'tag-orange'">{{s.payCycle||'-'}}</span></td>
          <td data-label="支付方式">{{s.payMethod||'-'}}</td>
          <td class="num" data-label="开票税点">{{s.taxPoint||0}}%</td>
          <td class="num" data-label="在售商品">{{goodsCount(s)}}</td>
          <td class="num money" data-label="累计采购">{{fmtMoney(purchaseAmt(s))}}</td>
          <td data-label="创建时间">{{s.createTime}}</td>
          <td data-label="状态"><x-status :v="s.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="openEdit(s)">编辑</span>
            <span class="link danger" @click="del(s)">删除</span>
            <span class="link" :class="s.status==='已启用'?'warn':'green'" @click="toggle(s)">{{s.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="13" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'编辑供应商':'新增供应商'" :width="700" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid">
        <div class="form-item"><label>供应商名称<b class="req">*</b></label><input type="text" v-model="form.name"></div>
        <div class="form-item"><label>开票税点（%）</label><input type="number" min="0" step="0.01" v-model.number="form.taxPoint"></div>
        <div class="form-item full"><label>地址</label><input type="text" v-model="form.address" placeholder="省 / 市 / 区 / 详细地址"></div>
        <div class="form-item"><label>业务联系人</label><input type="text" v-model="form.contactBiz" placeholder="姓名/职务/电话"></div>
        <div class="form-item"><label>业务联系电话或微信</label><input type="text" v-model="form.contactBizWechat"></div>
        <div class="form-item"><label>财务联系人</label><input type="text" v-model="form.contactFin" placeholder="姓名/职务/电话"></div>
        <div class="form-item"><label>财务联系电话或微信</label><input type="text" v-model="form.contactFinWechat"></div>
        <div class="form-item"><label>支付周期</label><x-combobox v-model="form.payCycle" :options="cycleOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>支付方式</label><x-combobox v-model="form.payMethod" :options="methodOpts" placeholder="请选择"/></div>
        <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
      </div>
      <div class="form-hint">支付周期：现结 / 货到付款；支付方式与系统统一（现金 / 微信 / 支付宝 / 收款码 / 对公 / 银行卡 / 其他）；开票税点用于采购成本核算参考。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <x-modal v-if="detail" :title="'供应商详情 - '+detail.name" :width="620" @close="detail=null">
      <div class="kv-grid">
        <div><label>供应商名称</label><span>{{detail.name}}</span></div>
        <div><label>状态</label><span><x-status :v="detail.status"/></span></div>
        <div class="full"><label>地址</label><span>{{detail.address||'-'}}</span></div>
        <div><label>业务联系人</label><span>{{detail.contactBiz||'-'}}</span></div>
        <div><label>业务电话/微信</label><span>{{detail.contactBizWechat||'-'}}</span></div>
        <div><label>财务联系人</label><span>{{detail.contactFin||'-'}}</span></div>
        <div><label>财务电话/微信</label><span>{{detail.contactFinWechat||'-'}}</span></div>
        <div><label>支付周期</label><span>{{detail.payCycle||'-'}}</span></div>
        <div><label>支付方式</label><span>{{detail.payMethod||'-'}}</span></div>
        <div><label>开票税点</label><span>{{detail.taxPoint||0}}%</span></div>
        <div><label>创建时间</label><span>{{detail.createTime}}</span></div>
        <div><label>在售商品数</label><span>{{goodsCount(detail)}}</span></div>
        <div><label>累计采购金额</label><span class="money">￥{{fmtMoney(purchaseAmt(detail))}}</span></div>
        <div class="full"><label>备注</label><span>{{detail.remark||'-'}}</span></div>
      </div>
      <template #foot><button class="btn" @click="detail=null">关闭</button></template>
    </x-modal>
  </div>`
};

Pages['page-goods'] = {
  components: { 'goods-list': GoodsList, 'supplier-list': SupplierList },
  data() { return { tab: '商品管理' }; },
  template: `
  <div>
    <div class="page-title">商品管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['商品管理','商品类型','单位管理','供应商管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <goods-list v-if="tab==='商品管理'"/>
      <dict-page v-else-if="tab==='商品类型'" coll="goodsTypes" label="商品类型"/>
      <dict-page v-else-if="tab==='单位管理'" coll="units" label="商品单位"/>
      <supplier-list v-else/>
    </div>
  </div>`
};
