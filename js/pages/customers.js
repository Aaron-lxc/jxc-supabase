/* 客户管理：客户管理 / 客户级别 / 客户类型 / 区域管理 */
window.Pages = window.Pages || {};

const CustomerList = {
  data() {
    return {
      q: { name: '', levelId: '', typeId: '', status: '', d1: '', d2: '' },
      page: 1, pageSize: 10, showForm: false, editing: null, form: {}, detail: null, selIds: [],
      showImport: false, importFile: null, importRows: [], importErrors: [], importOverwrite: false
    };
  },
  computed: {
    S() { return window.S; },
    rows() {
      return S.db.customers.filter(c =>
        U.kw(c.name, this.q.name) &&
        (!this.q.levelId || c.levelId === this.q.levelId) &&
        (!this.q.typeId || c.typeId === this.q.typeId) &&
        (!this.q.status || c.status === this.q.status) &&
        U.inRange(c.createTime, this.q.d1, this.q.d2)
      ).slice().sort((a, b) => (b.createTime || '').localeCompare(a.createTime || ''));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    levelOptsAll() { return [{ value: '', label: '全部级别' }].concat(S.db.custLevels.map(t => ({ value: t.id, label: t.name }))); },
    typeOptsAll() { return [{ value: '', label: '全部类型' }].concat(S.db.custTypes.map(t => ({ value: t.id, label: t.name }))); },
    statusOptsAll() { return [{ value: '', label: '全部状态' }, { value: '已启用', label: '已启用' }, { value: '未启用', label: '未启用' }]; },
    regionOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('regions').map(t => ({ value: t.id, label: t.name }))); },
    allChecked() { return this.rows.length > 0 && this.selIds.length === this.rows.length; },
    typeOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('custTypes').map(t => ({ value: t.id, label: t.name }))); },
    levelOpts() { return [{ value: '', label: '请选择' }].concat(S.enabled('custLevels').map(t => ({ value: t.id, label: t.name }))); },
    rpOpts() { return [{ value: null, label: '无' }].concat(S.enabled('resourcePartners').map(p => ({ value: p.id, label: p.name }))); },
    gpOpts() { return [{ value: null, label: '无' }].concat(S.enabled('regionPartners').map(p => ({ value: p.id, label: p.name }))); },
    payMethodOpts() { return (window.PAY_METHODS || ['对公', '微信', '收款码', '银行卡']).map(x => ({ value: x, label: x })); },
    payCycleOpts() { return ['现结', '当月结', '次月结'].map(x => ({ value: x, label: x })); },
    exemptOpts() { return ['否', '是'].map(x => ({ value: x, label: x })); }
  },
  methods: {
    fmtMoney: U.fmtMoney,
    rowFields(c) {
      return [
        { label: '客户编号', value: c.code },
        { label: '客户名称', value: c.name },
        { label: '区域', value: S.name('regions', c.regionId) },
        { label: '类型', value: S.name('custTypes', c.typeId) },
        { label: '级别', value: S.name('custLevels', c.levelId) },
        { label: '支付方式', value: c.payMethod },
        { label: '支付周期', value: c.payCycle + (c.payDay ? '/' + c.payDay + '号' : '') },
        { label: '税点', value: (c.taxRate || 0) + '%' },
        { label: '减免', value: c.taxExempt || '否' },
        { label: '一级资源', value: this.rpName(c.r1) },
        { label: '二级资源', value: this.rpName(c.r2) },
        { label: '三级资源', value: this.rpName(c.r3) },
        { label: '区域合伙人', value: c.regionPartnerId ? S.name('regionPartners', c.regionPartnerId) : '-' },
        { label: '累计欠款', value: U.fmtMoney(this.arrears(c)) },
        { label: '创建时间', value: c.createTime },
        { label: '状态', value: c.status }
      ];
    },
    arrears(c) { return S.custArrears(c.id); },
    rpName(id) { return id ? S.name('resourcePartners', id) : '-'; },
    /* 该客户已完成销售单产生的税点成本合计（仅计入成本侧，不影响销售额与佣金基数） */
    taxCost(c) {
      return U.round2(S.db.sales.filter(s => s.customerId === c.id && s.status === '已完成')
        .reduce((a, s) => a + S.saleTaxCost(s), 0));
    },
    blank() {
      return {
        name: '', regionId: '', typeId: '', levelId: '',
        contactRes: '', contactOrder: '', contactPay: '', contactOther: '', address: '',
        payMethod: '对公', payCycle: '现结', payDay: null,
        bankCard: '', corpAccount: '', invoiceInfo: '', taxRate: 0, taxExempt: '否',
        r1: null, r2: null, r3: null, regionPartnerId: null, remark: ''
      };
    },
    openNew() { this.editing = null; this.form = this.blank(); this.showForm = true; },
    openEdit(c) { this.editing = c; this.form = Object.assign(this.blank(), c); this.showForm = true; },
    save() {
      const f = this.form;
      if (!f.name.trim()) return alert('请输入客户名称');
      if (!f.regionId) return alert('请选择区域');
      if (!f.typeId) return alert('请选择客户类型');
      if (!f.levelId) return alert('请选择客户级别');
      if (f.payCycle !== '现结' && (!f.payDay || f.payDay < 1 || f.payDay > 31)) return alert('请填写支付时间（1-31 号）');
      const data = {
        name: f.name.trim(), regionId: f.regionId, typeId: f.typeId, levelId: f.levelId,
        contactRes: f.contactRes, contactOrder: f.contactOrder, contactPay: f.contactPay, contactOther: f.contactOther,
        address: f.address, payMethod: f.payMethod, payCycle: f.payCycle,
        payDay: f.payCycle === '现结' ? null : Number(f.payDay),
        bankCard: f.bankCard || '', corpAccount: f.corpAccount || '', invoiceInfo: f.invoiceInfo || '',
        taxRate: Number(f.taxRate) || 0, taxExempt: f.taxExempt || '否',
        r1: f.r1 || null, r2: f.r2 || null, r3: f.r3 || null,
        regionPartnerId: f.regionPartnerId || null, remark: f.remark
      };
      if (this.editing) {
        /* 税点变更需联动未完成销售单，务必在 Object.assign 之前取旧值 */
        const custId = this.editing.id;
        const taxChanged = Number(this.editing.taxRate || 0) !== data.taxRate
          || (this.editing.taxExempt || '否') !== data.taxExempt;
        Object.assign(this.editing, data);
        if (taxChanged) this.syncSaleTax(custId, data.taxRate, data.taxExempt);
      } else {
        S.db.customers.push({ id: S.genId(), code: S.genCode('CU'), ...data, createTime: U.now(), status: '已启用' });
      }
      this.showForm = false;
    },
    /* 客户税点变更后，同步其名下「未完成」销售单的税点；
       已完成单已固化快照不动；taxManual=true 的手工特调单保留原值 */
    syncSaleTax(custId, taxRate, taxExempt) {
      let n = 0, skip = 0;
      S.db.sales.forEach(s => {
        if (s.customerId !== custId || s.status === '已完成') return;
        if (s.taxManual === true) { skip++; return; }
        s.taxRate = taxRate; s.taxExempt = taxExempt; n++;
      });
      if (n || skip) {
        alert(`税点已更新：同步 ${n} 张未完成销售单`
          + (skip ? `，${skip} 张手工特调单保持不变` : '')
          + '（已完成单据不受影响）');
      }
    },
    del(c) {
      if (S.usedBy('customers', c.id)) return alert('该客户已有销售/投诉记录，无法删除，可改为停用');
      if (!U.confirm('确定删除客户「' + c.name + '」吗？')) return;
      S.db.customers = S.db.customers.filter(x => x.id !== c.id);
    },
    toggle(c) { c.status = c.status === '已启用' ? '未启用' : '已启用'; },
    exportData() {
      U.exportExcel('客户档案.xlsx', this.rows.map((c, i) => ({
        '序号': i + 1, '客户编号': c.code, '客户名称': c.name,
        '区域': S.name('regions', c.regionId), '类型': S.name('custTypes', c.typeId), '级别': S.name('custLevels', c.levelId),
        '支付方式': c.payMethod, '支付周期': c.payCycle + (c.payDay ? '/' + c.payDay + '号' : ''),
        '银行卡': c.bankCard || '', '对公账户': c.corpAccount || '', '开票信息': c.invoiceInfo || '',
        '税点(%)': c.taxRate || 0, '是否减免': c.taxExempt || '否', '累计税点成本': this.taxCost(c),
        '一级资源': this.rpName(c.r1), '二级资源': this.rpName(c.r2), '三级资源': this.rpName(c.r3),
        '区域合伙人': c.regionPartnerId ? S.name('regionPartners', c.regionPartnerId) : '-',
        '累计欠款': this.arrears(c), '创建时间': c.createTime, '状态': c.status
      })));
    },
    /* 批量评定：多选客户或评定全部 */
    cleanSel() { const ids = new Set(S.db.customers.map(c => c.id)); this.selIds = this.selIds.filter(id => ids.has(id)); },
    toggleAll(e) { this.selIds = e.target.checked ? this.rows.map(c => c.id) : []; },
    evalSelected() {
      if (!this.selIds.length) return alert('请先勾选要评定的客户');
      const n = S.evalCustomerLevels(this.selIds);
      alert('已重新评定 ' + n + ' 个选中客户');
      this.cleanSel();
    },
    evalAll() {
      const n = S.evalCustomerLevels(null);
      alert('已评定全部客户 ' + n + ' 个');
      this.selIds = [];
    },
    /* ---------- 客户批量导入 ---------- */
    openImport() {
      this.showImport = true;
      this.importFile = null;
      this.importRows = [];
      this.importErrors = [];
      this.importOverwrite = false;
    },
    downloadTpl() {
      const tpl = {
        '客户名称': '', '区域': '', '类型': '', '级别': '',
        '支付方式': '对公', '支付周期': '现结', '支付时间': '',
        '资源联系人/电话或微信': '', '报货联系人/电话或微信': '', '结算联系人/电话或微信': '', '其他联系人/电话或微信': '',
        '银行卡': '', '对公账户': '', '客户地址': '', '开票信息': '', '备注': '',
        '税点(%)': 0, '是否减免': '否',
        '一级资源': '', '二级资源': '', '三级资源': '', '区域合伙人': '', '状态': '已启用'
      };
      U.exportExcel('客户导入模板.xlsx', [tpl]);
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
      const existing = new Set(S.db.customers.map(c => (c.name || '').trim()));
      rows.forEach((r, i) => {
        const line = i + 2; // 含表头，Excel 物理行号从 2 起
        const name = ('' + (r['客户名称'] || '')).trim();
        if (!name) return; // 空行忽略
        const errs = [];
        const regionId = this.nameToId('regions', r['区域']);
        if (regionId === undefined) errs.push('区域「' + (r['区域'] || '') + '」不存在');
        const typeId = this.nameToId('custTypes', r['类型']);
        if (typeId === undefined) errs.push('类型「' + (r['类型'] || '') + '」不存在');
        const levelId = this.nameToId('custLevels', r['级别']);
        if (levelId === undefined) errs.push('级别「' + (r['级别'] || '') + '」不存在');
        const r1 = this.nameToId('resourcePartners', r['一级资源']);
        if (r1 === undefined) errs.push('一级资源「' + (r['一级资源'] || '') + '」不存在');
        const r2 = this.nameToId('resourcePartners', r['二级资源']);
        if (r2 === undefined) errs.push('二级资源「' + (r['二级资源'] || '') + '」不存在');
        const r3 = this.nameToId('resourcePartners', r['三级资源']);
        if (r3 === undefined) errs.push('三级资源「' + (r['三级资源'] || '') + '」不存在');
        const regionPartnerId = this.nameToId('regionPartners', r['区域合伙人']);
        if (regionPartnerId === undefined) errs.push('区域合伙人「' + (r['区域合伙人'] || '') + '」不存在');
        if (errs.length) { this.importErrors.push({ line, name, errs }); return; }
        const payCycle = ('' + (r['支付周期'] || '现结')).trim() || '现结';
        const payDayRaw = ('' + (r['支付时间'] || '')).trim();
        const payDay = (payCycle !== '现结' && payDayRaw) ? Math.min(31, Math.max(1, parseInt(payDayRaw, 10) || 1)) : null;
        const taxRateRaw = ('' + (r['税点(%)'] || '0')).trim();
        const taxExempt = ('' + (r['是否减免'] || '否')).trim() === '是' ? '是' : '否';
        const status = ('' + (r['状态'] || '已启用')).trim() === '未启用' ? '未启用' : '已启用';
        this.importRows.push({
          id: S.genId(), code: S.genCode('CU'), name, regionId, typeId, levelId, _dup: existing.has(name),
          contactRes: ('' + (r['资源联系人/电话或微信'] || '')).trim(),
          contactOrder: ('' + (r['报货联系人/电话或微信'] || '')).trim(),
          contactPay: ('' + (r['结算联系人/电话或微信'] || '')).trim(),
          contactOther: ('' + (r['其他联系人/电话或微信'] || '')).trim(),
          address: ('' + (r['客户地址'] || '')).trim(),
          payMethod: ('' + (r['支付方式'] || '对公')).trim() || '对公',
          payCycle, payDay,
          bankCard: ('' + (r['银行卡'] || '')).trim(),
          corpAccount: ('' + (r['对公账户'] || '')).trim(),
          invoiceInfo: ('' + (r['开票信息'] || '')).trim(),
          taxRate: Number(taxRateRaw) || 0, taxExempt,
          r1: r1 || null, r2: r2 || null, r3: r3 || null,
          regionPartnerId: regionPartnerId || null, remark: ('' + (r['备注'] || '')).trim(),
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
      if (!this.importRows.length) return alert('没有可导入的客户');
      let added = 0, updated = 0, skipped = 0;
      this.importRows.forEach(row => {
        const clean = Object.assign({}, row);
        delete clean._dup;
        const idx = S.db.customers.findIndex(c => (c.name || '').trim() === row.name);
        if (idx >= 0) {
          if (this.importOverwrite) { Object.assign(S.db.customers[idx], clean); updated++; }
          else { skipped++; }
        } else {
          S.db.customers.push(clean); added++;
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
      <input type="text" v-model="q.name" placeholder="客户名称模糊查询">
      <x-combobox v-model="q.levelId" :options="levelOptsAll" placeholder="全部级别"/>
      <x-combobox v-model="q.typeId" :options="typeOptsAll" placeholder="全部类型"/>
      <x-combobox v-model="q.status" :options="statusOptsAll" placeholder="全部状态"/>
      <label>创建时间</label><input type="date" v-model="q.d1"> - <input type="date" v-model="q.d2">
      <div class="spacer"></div>
      <button class="btn" @click="evalSelected" :disabled="!selIds.length">重新评定（选中 {{selIds.length||0}}）</button>
      <button class="btn" @click="evalAll">评定全部</button>
      <button class="btn" @click="openImport">导入</button>
      <button class="btn" @click="exportData">导出</button>
      <button class="btn btn-primary" @click="openNew">+ 新增客户</button>
    </div>
    <div class="table-wrap">
    <table class="grid">
      <thead><tr>
        <th style="width:38px"><input type="checkbox" :checked="allChecked" @change="toggleAll"></th>
        <th>客户编号</th><th>客户名称</th><th>区域</th><th>类型</th><th>级别</th>
        <th>支付方式</th><th>支付周期</th><th class="num">税点</th><th>减免</th><th>一级资源</th><th>二级资源</th><th>三级资源</th><th>区域合伙人</th>
        <th class="num">累计欠款</th><th>创建时间</th><th>状态</th><th>操作</th>
      </tr></thead>
      <tbody>
        <tr v-for="c in paged" :key="c.id">
          <td data-label="选择"><input type="checkbox" :value="c.id" v-model="selIds"></td>
          <td data-label="客户编号">{{c.code}}</td><td data-label="客户名称">{{c.name}}</td>
          <td data-label="区域">{{S.name('regions',c.regionId)}}</td><td data-label="类型">{{S.name('custTypes',c.typeId)}}</td><td data-label="级别">{{S.name('custLevels',c.levelId)}}</td>
          <td data-label="支付方式">{{c.payMethod}}</td>
          <td data-label="支付周期">{{c.payCycle}}<span v-if="c.payDay">/{{c.payDay}}号</span></td>
          <td class="num" data-label="税点">{{c.taxRate||0}}%</td>
          <td data-label="减免"><span class="tag" :class="(c.taxExempt==='是')?'tag-green':'tag-gray'">{{c.taxExempt||'否'}}</span></td>
          <td data-label="一级资源">{{rpName(c.r1)}}</td><td data-label="二级资源">{{rpName(c.r2)}}</td><td data-label="三级资源">{{rpName(c.r3)}}</td>
          <td data-label="区域合伙人">{{c.regionPartnerId ? S.name('regionPartners',c.regionPartnerId) : '-'}}</td>
          <td class="num money" :class="{red: arrears(c)>0}" data-label="累计欠款">{{fmtMoney(arrears(c))}}</td>
          <td data-label="创建时间">{{c.createTime}}</td>
          <td data-label="状态"><x-status :v="c.status"/></td>
          <td class="ops" data-label="操作">
            <span class="link" @click="detail=c">详情</span>
            <span class="link" @click="openEdit(c)">修改</span>
            <span class="link danger" @click="del(c)">删除</span>
            <span class="link" :class="c.status==='已启用'?'warn':'green'" @click="toggle(c)">{{c.status==='已启用'?'停用':'启用'}}</span>
          </td>
        </tr>
        <tr v-if="!paged.length"><td colspan="18" class="empty">暂无数据</td></tr>
      </tbody>
    </table>
    </div>
    <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>

    <x-modal v-if="showForm" :title="editing?'修改客户':'新增客户'" :width="760" :fullscreen="$root.isMobile" position="bottom" @close="showForm=false">
      <div class="form-grid cols3">
        <div class="form-item"><label>客户名称<b class="req">*</b></label><input type="text" v-model="form.name"></div>
        <div class="form-item"><label>区域名称<b class="req">*</b></label>
          <x-combobox v-model="form.regionId" :options="regionOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>客户类型<b class="req">*</b></label>
          <x-combobox v-model="form.typeId" :options="typeOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>客户级别<b class="req">*</b></label>
          <x-combobox v-model="form.levelId" :options="levelOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>资源联系人/电话或微信</label><input type="text" v-model="form.contactRes"></div>
        <div class="form-item"><label>报货联系人/电话或微信</label><input type="text" v-model="form.contactOrder"></div>
        <div class="form-item"><label>结算联系人/电话或微信</label><input type="text" v-model="form.contactPay"></div>
        <div class="form-item"><label>其他联系人/电话或微信</label><input type="text" v-model="form.contactOther"></div>
        <div class="form-item"><label>支付方式</label>
          <x-combobox v-model="form.payMethod" :options="payMethodOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>支付周期</label>
          <x-combobox v-model="form.payCycle" :options="payCycleOpts" placeholder="请选择"/></div>
        <div class="form-item" v-if="form.payCycle!=='现结'"><label>支付时间（几号）<b class="req">*</b></label>
          <input type="number" min="1" max="31" v-model.number="form.payDay" placeholder="1-31"></div>
        <div class="form-item"><label>银行卡</label><input type="text" v-model="form.bankCard" placeholder="开户行 / 卡号 / 户名"></div>
        <div class="form-item"><label>对公账户</label><input type="text" v-model="form.corpAccount" placeholder="开户行 / 账号 / 户名"></div>
        <div class="form-item"><label>税点（%）</label><input type="number" min="0" max="100" step="0.01" v-model.number="form.taxRate"></div>
        <div class="form-item"><label>是否减免税点</label>
          <x-combobox v-model="form.taxExempt" :options="exemptOpts" placeholder="否"/></div>
        <div class="form-item full"><label>客户开票信息</label>
          <textarea rows="2" v-model="form.invoiceInfo" placeholder="抬头 / 税号 / 地址电话 / 开户行及账号"></textarea></div>
        <div class="form-item"><label>一级资源</label>
          <x-combobox v-model="form.r1" :options="rpOpts" placeholder="无"/></div>
        <div class="form-item"><label>二级资源</label>
          <x-combobox v-model="form.r2" :options="rpOpts" placeholder="无"/></div>
        <div class="form-item"><label>三级资源</label>
          <x-combobox v-model="form.r3" :options="rpOpts" placeholder="无"/></div>
        <div class="form-item"><label>区域合伙人</label>
          <x-combobox v-model="form.regionPartnerId" :options="gpOpts" placeholder="无"/></div>
        <div class="form-item full"><label>客户地址</label><input type="text" v-model="form.address"></div>
        <div class="form-item full"><label>备注</label><textarea rows="2" v-model="form.remark"></textarea></div>
      </div>
      <div class="form-hint" style="margin-top:8px">提示：合伙人档案在「合伙人管理」中维护；同一资源合伙人可同时担任不同客户的一级/二级/三级资源。<br>
        税点说明：销售单会自动带出客户税点快照，税点成本仅计入成本 / 毛利 / 报表，不放大销售额与佣金基数；勾选「是否减免＝是」则该客户不计税点成本。</div>
      <template #foot>
        <button class="btn" @click="showForm=false">取消</button>
        <button class="btn btn-primary" @click="save">保存</button>
      </template>
    </x-modal>

    <x-modal v-if="detail" :title="'客户详情 - '+detail.name" :width="620" @close="detail=null">
      <div class="form-grid">
        <div class="form-item"><label>客户编号</label><div>{{detail.code}}</div></div>
        <div class="form-item"><label>客户地址</label><div>{{detail.address||'-'}}</div></div>
        <div class="form-item"><label>资源联系人</label><div>{{detail.contactRes||'-'}}</div></div>
        <div class="form-item"><label>报货联系人</label><div>{{detail.contactOrder||'-'}}</div></div>
        <div class="form-item"><label>结算联系人</label><div>{{detail.contactPay||'-'}}</div></div>
        <div class="form-item"><label>其他联系人</label><div>{{detail.contactOther||'-'}}</div></div>
        <div class="form-item"><label>支付</label><div>{{detail.payMethod}} / {{detail.payCycle}}<span v-if="detail.payDay"> / 每月{{detail.payDay}}号</span></div></div>
        <div class="form-item"><label>累计欠款</label><div class="red money">￥{{fmtMoney(arrears(detail))}}</div></div>
        <div class="form-item"><label>银行卡</label><div>{{detail.bankCard||'-'}}</div></div>
        <div class="form-item"><label>对公账户</label><div>{{detail.corpAccount||'-'}}</div></div>
        <div class="form-item"><label>税点 / 是否减免</label><div>{{detail.taxRate||0}}% ｜ {{detail.taxExempt||'否'}}</div></div>
        <div class="form-item"><label>累计税点成本</label><div class="money">￥{{fmtMoney(taxCost(detail))}}</div></div>
        <div class="form-item full"><label>客户开票信息</label><div style="white-space:pre-wrap">{{detail.invoiceInfo||'-'}}</div></div>
        <div class="form-item full"><label>备注</label><div>{{detail.remark||'-'}}</div></div>
      </div>
      <template #foot><button class="btn" @click="detail=null">关闭</button></template>
    </x-modal>

    <x-modal v-if="showImport" title="客户批量导入" :width="720" :fullscreen="$root.isMobile" position="bottom" @close="showImport=false">
      <div class="form-hint" style="margin-bottom:8px">
        1）先点「下载导入模板」，按表头填写；<b>必填：客户名称 / 区域 / 类型 / 级别</b>，须与系统已有字典名称完全一致（含空格）。<br>
        2）选择填好的 Excel / CSV 文件，系统自动解析校验；<br>
        3）确认预览与错误清单后点「确认导入」。同名客户默认跳过，勾选「已存在则更新」可覆盖。
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px">
        <button class="btn" @click="downloadTpl">下载导入模板</button>
        <label class="btn"><input type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onImportFile">选择文件…</label>
        <span v-if="importFile" style="color:#475569">{{importFile}}</span>
      </div>
      <div v-if="importRows.length || importErrors.length">
        <div style="margin:6px 0;font-weight:600">待导入 {{importRows.length}} 条，错误 {{importErrors.length}} 条</div>
        <div class="table-wrap" style="max-height:240px;overflow:auto">
          <table class="grid">
            <thead><tr><th>客户名称</th><th>区域</th><th>类型</th><th>级别</th><th>状态</th><th>重复</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in importRows" :key="i">
                <td>{{r.name}}</td><td>{{S.name('regions',r.regionId)}}</td><td>{{S.name('custTypes',r.typeId)}}</td><td>{{S.name('custLevels',r.levelId)}}</td><td>{{r.status}}</td><td>{{r._dup?'是':'否'}}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="importErrors.length" style="margin-top:8px;color:#dc2626">
          <div style="font-weight:600">错误清单（这些行不会导入）：</div>
          <div v-for="(e,i) in importErrors" :key="'e'+i" style="font-size:13px;margin:2px 0">第 {{e.line}} 行 · {{e.name}}：{{e.errs.join('；')}}</div>
        </div>
        <label style="display:flex;gap:6px;align-items:center;margin-top:8px">
          <input type="checkbox" v-model="importOverwrite"> 已存在则更新（按客户名称覆盖已有客户）
        </label>
      </div>
      <template #foot>
        <button class="btn" @click="showImport=false">取消</button>
        <button class="btn btn-primary" :disabled="!importRows.length" @click="doImport">确认导入（{{importRows.length}} 条）</button>
      </template>
    </x-modal>
  </div>`
};

Pages['page-customers'] = {
  components: { 'customer-list': CustomerList },
  data() { return { tab: '客户管理' }; },
  template: `
  <div>
    <div class="page-title">客户管理</div>
    <div class="tabs">
      <div class="tab" v-for="t in ['客户管理','客户级别','客户类型','区域管理']" :key="t" :class="{active:tab===t}" @click="tab=t">{{t}}</div>
    </div>
    <div class="card">
      <customer-list v-if="tab==='客户管理'"/>
      <dict-page v-else-if="tab==='客户级别'" coll="custLevels" label="客户级别"/>
      <dict-page v-else-if="tab==='客户类型'" coll="custTypes" label="客户类型"/>
      <dict-page v-else coll="regions" label="区域名称"/>
    </div>
  </div>`
};
