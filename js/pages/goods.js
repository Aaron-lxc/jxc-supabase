/* 商品管理：商品管理 / 商品类型 / 单位管理 / 供应商管理 */
window.Pages = window.Pages || {};

const GoodsList = {
  data() {
    return {
      q: { name: '', typeId: '', status: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null,
      form: {},
      /* 批量导入 */
      showImport: false, importFile: null, importRows: [], importErrors: [], importOverwrite: false
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
      ).slice().sort((a, b) => (U.rankEnabled(a.status) - U.rankEnabled(b.status)) || (b.createTime || '').localeCompare(a.createTime || ''));
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
      if (f.purchasePrice == null) return alert('请填写采购价');
      if (this.editing) {
        Object.assign(this.editing, {
          name: f.name.trim(), typeId: f.typeId, sku: f.sku, unitId: f.unitId, supplierId: f.supplierId,
          purchasePrice: Number(f.purchasePrice), retailPrice: Number(f.retailPrice) || 0,
          bigPrice: Number(f.bigPrice) || 0, wholePrice: Number(f.wholePrice) || 0,
          minStock: Number(f.minStock) || 0, shelfLife: Number(f.shelfLife) || 0, expireWarn: Number(f.expireWarn) || 0
        });
      } else {
        S.db.goods.push({
          id: S.genId(), code: S.genCode('GD'), name: f.name.trim(), typeId: f.typeId, sku: f.sku,
          unitId: f.unitId, supplierId: f.supplierId,
          purchasePrice: Number(f.purchasePrice), retailPrice: Number(f.retailPrice) || 0,
          bigPrice: Number(f.bigPrice) || 0, wholePrice: Number(f.wholePrice) || 0,
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
    toggle(g) { g.status = g.status === '已启用' ? '未启用' : '已启用'; },
    /* ---------- 导出当前筛选结果 ---------- */
    exportData() {
      if (!this.rows.length) return alert('没有可导出的数据');
      U.exportExcel('商品档案.xlsx', this.rows.map((g, i) => ({
        '序号': i + 1, '商品编号': g.code, '商品名称': g.name,
        '商品类型': S.name('goodsTypes', g.typeId), 'SKU': g.sku || '',
        '单位': S.name('units', g.unitId), '供应商': S.name('suppliers', g.supplierId),
        '采购价': Number(g.purchasePrice) || 0, '零售价': Number(g.retailPrice) || 0,
        '大客价': Number(g.bigPrice) || 0, '批发价': Number(g.wholePrice) || 0,
        '最低库存': Number(g.minStock) || 0, '保质期(天)': Number(g.shelfLife) || 0, '临期提醒(天)': Number(g.expireWarn) || 0,
        '创建时间': g.createTime, '状态': g.status
      })));
    },
    /* ---------- 商品批量导入 ---------- */
    openImport() {
      this.showImport = true;
      this.importFile = null;
      this.importRows = [];
      this.importErrors = [];
      this.importOverwrite = false;
    },
    downloadTpl() {
      const tpl = {
        '商品名称': '', '商品类型': '', 'SKU': '', '单位': '', '供应商': '',
        '采购价': 0, '零售价': 0, '大客价': 0, '批发价': 0,
        '最低库存': 0, '保质期(天)': 0, '临期提醒(天)': 0, '状态': '已启用'
      };
      U.exportExcel('商品导入模板.xlsx', [tpl]);
    },
    /* 名称→ID：留空返回 null；找不到返回 undefined（与 null 区分，用于报错） */
    nameToId(coll, name) {
      if (name === undefined || name === null || ('' + name).trim() === '') return null;
      const list = S.enabled(coll);
      const nm = ('' + name).trim();
      const hit = list.find(x => (x.name || '').trim() === nm);
      return hit ? hit.id : undefined;
    },
    parseImport(rows) {
      this.importRows = [];
      this.importErrors = [];
      const existing = new Set(S.db.goods.map(g => (g.name || '').trim()));
      rows.forEach((r, i) => {
        const line = i + 2; // 含表头，Excel 物理行号从 2 起
        const name = ('' + (r['商品名称'] || '')).trim();
        if (!name) return; // 空行忽略
        const errs = [];
        const typeId = this.nameToId('goodsTypes', r['商品类型']);
        if (typeId === undefined) errs.push('商品类型「' + (r['商品类型'] || '') + '」不存在');
        const unitId = this.nameToId('units', r['单位']);
        if (unitId === undefined) errs.push('单位「' + (r['单位'] || '') + '」不存在');
        const supplierId = this.nameToId('suppliers', r['供应商']);
        if (supplierId === undefined) errs.push('供应商「' + (r['供应商'] || '') + '」不存在');
        const num = (v, dflt) => { const n = Number(v); return isNaN(n) ? dflt : n; };
        const purchasePrice = num(r['采购价'], null);
        if (purchasePrice == null || purchasePrice < 0) errs.push('采购价必填且不能为负');
        const retailPrice = num(r['零售价'], 0) || 0;
        if (retailPrice < 0) errs.push('零售价不能为负');
        const status = ('' + (r['状态'] || '已启用')).trim() === '未启用' ? '未启用' : '已启用';
        if (errs.length) { this.importErrors.push({ line, name, errs }); return; }
        this.importRows.push({
          id: S.genId(), code: S.genCode('GD'), name, typeId, unitId, supplierId,
          sku: ('' + (r['SKU'] || '')).trim(),
          purchasePrice, retailPrice,
          bigPrice: num(r['大客价'], 0) || 0,
          wholePrice: num(r['批发价'], 0) || 0,
          minStock: num(r['最低库存'], 0) || 0,
          shelfLife: num(r['保质期(天)'], 0) || 0,
          expireWarn: num(r['临期提醒(天)'], 0) || 0,
          _dup: existing.has(name),
          createTime: U.now(), status
        });
      });
    },
    async onImportFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      this.importFile = file.name;
      try {
        await U.ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        this.parseImport(rows);
      } catch (err) {
        alert('文件解析失败：' + (err && err.message ? err.message : err));
        this.importRows = [];
        this.importErrors = [];
      }
      e.target.value = '';
    },
    doImport() {
      if (!this.importRows.length) return alert('没有可导入的商品');
      let added = 0, updated = 0, skipped = 0;
      this.importRows.forEach(row => {
        const clean = Object.assign({}, row);
        delete clean._dup;
        const idx = S.db.goods.findIndex(g => (g.name || '').trim() === row.name);
        if (idx >= 0) {
          if (this.importOverwrite) { Object.assign(S.db.goods[idx], clean); updated++; }
          else { skipped++; }
        } else {
          S.db.goods.push(clean); added++;
        }
      });
      alert('导入完成：新增 ' + added + '，更新 ' + updated + '，跳过重复 ' + skipped + '，错误 ' + this.importErrors.length + ' 行');
      this.showImport = false;
      this.page = 1;
    }
  },
  template: `
  <div>
    <div class="toolbar">
      <input type="text" v-model="q.name" placeholder="商品名称模糊查询">
      <x-combobox v-model="q.typeId" :options="typeOptsAll" placeholder="全部类型"/>
      <x-combobox v-model="q.status" :options="statusOptsAll" placeholder="全部状态"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <button class="btn" @click="openImport">导入</button>
      <button class="btn" @click="exportData">导出</button>
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
        <div class="form-item"><label>零售价</label><input type="number" min="0" step="0.01" v-model.number="form.retailPrice"></div>
        <div class="form-item"><label>大客价</label><input type="number" min="0" step="0.01" v-model.number="form.bigPrice"></div>
        <div class="form-item"><label>批发价</label><input type="number" min="0" step="0.01" v-model.number="form.wholePrice"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <x-modal v-if="showImport" title="商品批量导入" :width="720" :fullscreen="$root.isMobile" position="bottom" @close="showImport=false">
      <div class="form-hint" style="margin-bottom:8px">
        1）先点「下载导入模板」，按表头填写；<b>必填：商品名称 / 商品类型 / 单位 / 供应商 / 采购价 / 零售价</b>，类型 / 单位 / 供应商须与系统已有字典名称完全一致（含空格）。<br>
        2）选择填好的 Excel / CSV 文件，系统自动解析校验；<br>
        3）确认预览与错误清单后点「确认导入」。同名商品默认跳过，勾选「已存在则更新」可覆盖。
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <button class="btn" @click="downloadTpl">下载导入模板</button>
        <label class="btn"><input type="file" accept=".xlsx,.xls,.csv" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" @change="onImportFile">选择文件…</label>
        <span v-if="importFile" style="color:#475569">{{importFile}}</span>
      </div>
      <div v-if="importRows.length || importErrors.length">
        <div style="margin:6px 0;font-weight:600">待导入 {{importRows.length}} 条，错误 {{importErrors.length}} 条</div>
        <div class="table-wrap" style="max-height:240px;overflow:auto">
          <table class="grid">
            <thead><tr><th>商品名称</th><th>商品类型</th><th>单位</th><th>供应商</th><th>零售价</th><th>状态</th><th>重复</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in importRows" :key="i">
                <td>{{r.name}}</td><td>{{S.name('goodsTypes',r.typeId)}}</td><td>{{S.name('units',r.unitId)}}</td><td>{{S.name('suppliers',r.supplierId)}}</td><td>{{r.retailPrice}}</td><td>{{r.status}}</td><td>{{r._dup?'是':'否'}}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="importErrors.length" style="margin-top:8px;color:#dc2626">
          <div style="font-weight:600">错误清单（这些行不会导入）：</div>
          <div v-for="(e,i) in importErrors" :key="'e'+i" style="font-size:13px;margin:2px 0">第 {{e.line}} 行 · {{e.name}}：{{e.errs.join('；')}}</div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px">
          <input type="checkbox" v-model="importOverwrite"> 已存在则更新（按商品名称覆盖已有商品）
        </label>
      </div>
      <template #foot>
        <button class="btn" @click="showImport=false">取消</button>
        <button class="btn btn-primary" :disabled="!importRows.length" @click="doImport">确认导入（{{importRows.length}} 条）</button>
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
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}, detail: null,
      /* 批量导入 */
      showImport: false, importFile: null, importRows: [], importErrors: [], importOverwrite: false
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
      ).slice().sort((a, b) => (U.rankEnabled(a.status) - U.rankEnabled(b.status)) || (b.createTime || '').localeCompare(a.createTime || ''));
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
    payableAmt(s) {
      /* 供应商累计应付 = 累计采购额 + 启用后的期初应付（与期初库存口径一致：启用后生效） */
      let amt = this.purchaseAmt(s);
      if (S.db.settings.openingFlags.ap) amt += S.supplierOpeningAp(s.id);
      return U.round2(amt);
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
        '在售商品数': this.goodsCount(s), '累计采购金额': this.purchaseAmt(s), '累计应付(含期初应付)': this.payableAmt(s),
        '创建时间': s.createTime, '状态': s.status
      })));
    },
    /* ---------- 供应商批量导入 ---------- */
    openImport() {
      this.showImport = true;
      this.importFile = null;
      this.importRows = [];
      this.importErrors = [];
      this.importOverwrite = false;
    },
    downloadTpl() {
      const tpl = {
        '供应商名称': '', '地址': '', '业务联系人': '', '业务微信': '',
        '财务联系人': '', '财务微信': '', '支付周期': '现结', '支付方式': '对公',
        '开票税点(%)': 0, '备注': '', '状态': '已启用'
      };
      U.exportExcel('供应商导入模板.xlsx', [tpl]);
    },
    parseImport(rows) {
      this.importRows = [];
      this.importErrors = [];
      const existing = new Set(S.db.suppliers.map(s => (s.name || '').trim()));
      rows.forEach((r, i) => {
        const line = i + 2; // 含表头，Excel 物理行号从 2 起
        const name = ('' + (r['供应商名称'] || '')).trim();
        if (!name) return; // 空行忽略
        const errs = [];
        const payCycle = ('' + (r['支付周期'] || '现结')).trim() || '现结';
        if (!PAY_CYCLES.includes(payCycle)) errs.push('支付周期须为「现结」或「货到付款」');
        const payMethod = ('' + (r['支付方式'] || '对公')).trim() || '对公';
        if (!PAY_METHODS.includes(payMethod)) errs.push('支付方式「' + payMethod + '」不在系统支付方式内');
        const num = (v, dflt) => { const n = Number(v); return isNaN(n) ? dflt : n; };
        const taxPoint = num(r['开票税点(%)'], 0);
        if (taxPoint < 0) errs.push('开票税点不能为负');
        const status = ('' + (r['状态'] || '已启用')).trim() === '未启用' ? '未启用' : '已启用';
        if (errs.length) { this.importErrors.push({ line, name, errs }); return; }
        this.importRows.push({
          name,
          address: ('' + (r['地址'] || '')).trim(),
          contactBiz: ('' + (r['业务联系人'] || '')).trim(),
          contactBizWechat: ('' + (r['业务微信'] || '')).trim(),
          contactFin: ('' + (r['财务联系人'] || '')).trim(),
          contactFinWechat: ('' + (r['财务微信'] || '')).trim(),
          payCycle, payMethod, taxPoint,
          remark: ('' + (r['备注'] || '')).trim(),
          _dup: existing.has(name), status
        });
      });
    },
    async onImportFile(e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      this.importFile = file.name;
      try {
        await U.ensureXLSX();
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        this.parseImport(rows);
      } catch (err) {
        alert('文件解析失败：' + (err && err.message ? err.message : err));
        this.importRows = [];
        this.importErrors = [];
      }
      e.target.value = '';
    },
    doImport() {
      if (!this.importRows.length) return alert('没有可导入的供应商');
      let added = 0, updated = 0, skipped = 0;
      this.importRows.forEach(row => {
        const clean = Object.assign({}, row);
        delete clean._dup;
        const idx = S.db.suppliers.findIndex(s => (s.name || '').trim() === row.name);
        if (idx >= 0) {
          if (this.importOverwrite) {
            Object.assign(S.db.suppliers[idx], clean, { id: S.db.suppliers[idx].id, createTime: S.db.suppliers[idx].createTime });
            updated++;
          } else { skipped++; }
        } else {
          S.db.suppliers.push(Object.assign({ id: S.genId(), createTime: U.now() }, clean));
          added++;
        }
      });
      alert('导入完成：新增 ' + added + '，更新 ' + updated + '，跳过重复 ' + skipped + '，错误 ' + this.importErrors.length + ' 行');
      this.showImport = false;
      this.page = 1;
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
      <button class="btn" @click="openImport">导入</button>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增供应商</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th>序号</th><th>供应商名称</th><th>地址</th><th>业务联系人 / 电话或微信</th><th>财务联系人 / 电话或微信</th>
        <th>支付周期</th><th>支付方式</th><th class="num">开票税点</th><th class="num">在售商品</th><th class="num">累计采购</th><th class="num">累计应付</th>
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
          <td class="num money" :class="{red: payableAmt(s)>purchaseAmt(s)}" data-label="累计应付">{{fmtMoney(payableAmt(s))}}</td>
          <td data-label="创建时间">{{s.createTime}}</td>
          <td data-label="状态"><x-status :v="s.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="openEdit(s)">编辑</span>
            <span class="link danger" @click="del(s)">删除</span>
            <span class="link" :class="s.status==='已启用'?'warn':'green'" @click="toggle(s)">{{s.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="14" class="empty">暂无数据</td></tr>
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
        <div><label>累计应付（含期初应付）</label><span class="money red">￥{{fmtMoney(payableAmt(detail))}}</span></div>
        <div class="full"><label>备注</label><span>{{detail.remark||'-'}}</span></div>
      </div>
      <template #foot><button class="btn" @click="detail=null">关闭</button></template>
    </x-modal>

    <x-modal v-if="showImport" title="供应商批量导入" :width="720" :fullscreen="$root.isMobile" position="bottom" @close="showImport=false">
      <div class="form-hint" style="margin-bottom:8px">
        1）先点「下载导入模板」，按表头填写；<b>必填：供应商名称</b>；支付周期须为「现结 / 货到付款」，支付方式须与系统统一（现金 / 微信 / 支付宝 / 收款码 / 对公 / 银行卡 / 其他）。<br>
        2）选择填好的 Excel / CSV 文件，系统自动解析校验；<br>
        3）确认预览与错误清单后点「确认导入」。同名供应商默认跳过，勾选「已存在则更新」可覆盖。
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <button class="btn" @click="downloadTpl">下载导入模板</button>
        <label class="btn"><input type="file" accept=".xlsx,.xls,.csv" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" @change="onImportFile">选择文件…</label>
        <span v-if="importFile" style="color:#475569">{{importFile}}</span>
      </div>
      <div v-if="importRows.length || importErrors.length">
        <div style="margin:6px 0;font-weight:600">待导入 {{importRows.length}} 条，错误 {{importErrors.length}} 条</div>
        <div class="table-wrap" style="max-height:240px;overflow:auto">
          <table class="grid">
            <thead><tr><th>供应商名称</th><th>地址</th><th>业务联系人</th><th>财务联系人</th><th>支付周期</th><th>支付方式</th><th>税点</th><th>状态</th><th>重复</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in importRows" :key="i">
                <td>{{r.name}}</td><td>{{r.address}}</td><td>{{r.contactBiz}}</td><td>{{r.contactFin}}</td><td>{{r.payCycle}}</td><td>{{r.payMethod}}</td><td>{{r.taxPoint}}%</td><td>{{r.status}}</td><td>{{r._dup?'是':'否'}}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="importErrors.length" style="margin-top:8px;color:#dc2626">
          <div style="font-weight:600">错误清单（这些行不会导入）：</div>
          <div v-for="(e,i) in importErrors" :key="'e'+i" style="font-size:13px;margin:2px 0">第 {{e.line}} 行 · {{e.name}}：{{e.errs.join('；')}}</div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px">
          <input type="checkbox" v-model="importOverwrite"> 已存在则更新（按供应商名称覆盖已有供应商）
        </label>
      </div>
      <template #foot>
        <button class="btn" @click="showImport=false">取消</button>
        <button class="btn btn-primary" :disabled="!importRows.length" @click="doImport">确认导入（{{importRows.length}} 条）</button>
      </template>
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
