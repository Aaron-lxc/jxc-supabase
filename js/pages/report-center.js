/* 佣金报表（原报表中心）：
   - 报表接收人(非管理者)：服务端按 recipient_profiles 裁剪，客户端只渲染其专属报表
   - 创建者/管理员：拥有全量数据权限，直接用本地 S.db 渲染「总览」并可在页内自由切换任意报表/合伙人 */
window.Pages = window.Pages || {};

Pages['page-reportcenter'] = {
  data() {
    return {
      loading: true, err: '', role: '', type: '', partner: null,
      db: null, partial: null, generatedAt: '',
      view: 'overview',     // 管理者视图：overview | resource | region
      selPid: null,         // 自由切换选中的合伙人 id（资源/区域）
      fResName: '', fRegName: '',
      pageRes: 1, pageSizeRes: 10, pageReg: 1, pageSizeReg: 10
    };
  },
  async created() {
    // 管理者：直接使用本地全量数据，无需调用 report-detail
    if (P.isManager()) {
      const g = (window.S && window.S.db) || null;
      if (!g) { this.err = '数据尚未加载，请返回主界面点击「同步」后再试。'; this.loading = false; return; }
      this.db = g;
      this.view = 'overview';
      this.generatedAt = new Date().toLocaleString('zh-CN');
      this.loading = false;
      return;
    }
    // 接收人：服务端按 profile 裁剪后返回
    try {
      const ws = Cloud.state.ws && Cloud.state.ws.id;
      if (!ws) { this.err = '未选择账套'; this.loading = false; return; }
      const { data } = await Cloud.sb.auth.getSession();
      const token = data.session && data.session.access_token;
      if (!token) { this.err = '登录状态失效，请重新登录'; this.loading = false; return; }
      const base = (CFG.read() && CFG.read().url) || '';
      const url = base + '/functions/v1/report-detail?ws=' + encodeURIComponent(ws);
      const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { this.err = (j && j.error) || ('加载失败(' + res.status + ')'); this.loading = false; return; }
      this.role = j.role || '';
      if (j.partial) { this.partial = j.partial; this.partner = j.partner || null; this.type = j.type || ''; }
      else { this.db = j.db || null; }
      this.generatedAt = new Date().toLocaleString('zh-CN');
      this.loading = false;
    } catch (e) {
      this.err = (e && e.message) || String(e);
      this.loading = false;
    }
  },
  computed: {
    isMgr() { return P.isManager(); },
    S() {
      if (this.partial) return ComputeCore.makeCompute(this.partial);
      if (this.db) return ComputeCore.makeCompute(this.db);
      return null;
    },
    /* 渲染用的角色：管理者用页内 view，接收人用服务端下发的 role */
    renderRole() { return this.isMgr ? this.view : this.role; },
    /* 当前激活的合伙人对象（接收人=profile.partner；管理者=选择的下拉项） */
    activePartner() {
      if (this.isMgr) {
        if (this.view !== 'resource' && this.view !== 'region') return null;
        const coll = this.view === 'region' ? 'regionPartners' : 'resourcePartners';
        return (this.db && this.db[coll] || []).find(x => x.id === this.selPid) || null;
      }
      return this.partner;
    },
    activeType() { return this.isMgr ? (this.view === 'region' ? '区域' : '资源') : (this.type || '资源'); },
    pid() { return this.activePartner ? this.activePartner.id : null; },
    ptype() { return this.activeType === '区域' ? '区域' : '资源'; },
    commission() {
      if (!this.S || !this.pid) return null;
      try { return this.S.partnerCommissionAccount(this.pid, this.ptype); } catch (e) { return null; }
    },
    pledges() {
      if (!this.S || !this.pid) return [];
      try { return this.S.pledgeList(this.pid, this.ptype); } catch (e) { return []; }
    },
    custLines() {
      if (!this.S || !this.pid) return [];
      try { return this.S.resourceCustomerLines(this.pid); } catch (e) { return []; }
    },
    /* 总览：全部资源/区域合伙人佣金一览 */
    ovRes() { return this._partners('resourcePartners', '资源'); },
    ovReg() { return this._partners('regionPartners', '区域'); },
    ovResRows() {
      const k = this.fResName.trim();
      return this.ovRes.filter(r => !k || (r.p.name || '').toLowerCase().includes(k.toLowerCase()));
    },
    ovRegRows() {
      const k = this.fRegName.trim();
      return this.ovReg.filter(r => !k || (r.p.name || '').toLowerCase().includes(k.toLowerCase()));
    },
    ovResPaged() { return this.ovResRows.slice((this.pageRes - 1) * this.pageSizeRes, this.pageRes * this.pageSizeRes); },
    ovRegPaged() { return this.ovRegRows.slice((this.pageReg - 1) * this.pageSizeReg, this.pageReg * this.pageSizeReg); }
  },
  watch: {
    fResName() { this.pageRes = 1; },
    fRegName() { this.pageReg = 1; }
  },
  methods: {
    fmt(n) {
      return ComputeCore.U.round2(Number(n) || 0).toLocaleString('zh-CN',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    dbPartners(coll) { return (this.db && this.db[coll]) || []; },
    _partners(coll, type) {
      if (!this.S || !this.db) return [];
      return (this.db[coll] || []).map(p => ({ p, c: this._safe(() => this.S.partnerCommissionAccount(p.id, type)) }));
    },
    _safe(fn) { try { return fn() || null; } catch (e) { return null; } },
    exportOv(kind) {
      const rows = kind === 'res' ? this.ovResRows : this.ovRegRows;
      const name = kind === 'res' ? '资源合伙人佣金一览' : '区域合伙人佣金一览';
      U.exportExcel(name + '.xlsx', rows.map((r, i) => ({
        '序号': i + 1, '合伙人': r.p.name,
        '累计总佣金': this.fmt(r.c && r.c.earned), '已支付': this.fmt(r.c && r.c.paid),
        '质押': this.fmt(r.c && r.c.pledge), '待支付': this.fmt(r.c && r.c.payable)
      })));
    }
  },
  template: `
  <div>
    <div class="page-title">佣金报表</div>
    <div v-if="loading" class="muted" style="padding:20px 0">正在加载报表…</div>
    <div v-else-if="err" class="gate-err" style="white-space:pre-line">{{err}}</div>
    <template v-else>
      <div class="muted" style="margin-bottom:10px">生成时间：{{generatedAt}}</div>

      <!-- 管理者控制条：总览 + 自由切换 -->
      <div class="card" v-if="isMgr">
        <h3>佣金报表（管理者总览）</h3>
        <div class="form-grid">
          <div class="form-item"><label>视图</label>
            <select v-model="view">
              <option value="overview">总览（全部）</option>
              <option value="resource">资源合伙人</option>
              <option value="region">区域合伙人</option>
            </select>
          </div>
          <div class="form-item" v-if="view==='resource' || view==='region'"><label>选择合伙人</label>
            <select v-model="selPid">
              <option :value="null">请选择</option>
              <option v-for="p in dbPartners(view==='region' ? 'regionPartners' : 'resourcePartners')" :key="p.id" :value="p.id">{{p.name}}</option>
            </select>
          </div>
        </div>
        <div class="muted" style="margin-top:6px">管理者拥有全量数据权限，可在此总览全部报表并自由切换查看任意合伙人明细。</div>
      </div>

      <!-- 总览：仅保留两张佣金一览 -->
      <template v-if="renderRole==='overview'">
        <div class="card" v-if="ovRes.length">
          <h3>资源合伙人佣金一览（{{ovResRows.length}} 人）
            <span style="float:right;font-weight:400;display:flex;gap:8px;align-items:center">
              <input type="text" v-model="fResName" placeholder="搜索合伙人" style="width:150px">
              <button class="btn btn-sm" @click="exportOv('res')">导出</button>
            </span>
          </h3>
          <div class="table-wrap"><table class="grid rc-comm">
            <thead><tr><th style="width:56px">序号</th><th>合伙人</th><th>累计总佣金</th><th>已支付</th><th>质押</th><th>待支付</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in ovResPaged" :key="r.p.id"><td data-label="序号">{{(pageRes-1)*pageSizeRes+i+1}}</td><td data-label="合伙人">{{r.p.name}}</td>
                <td class="num money" data-label="累计总佣金">{{fmt(r.c && r.c.earned)}}</td>
                <td class="num money" data-label="已支付">{{fmt(r.c && r.c.paid)}}</td>
                <td class="num money" data-label="质押">{{fmt(r.c && r.c.pledge)}}</td>
                <td class="num money red" data-label="待支付">{{fmt(r.c && r.c.payable)}}</td></tr>
              <tr v-if="!ovResPaged.length"><td colspan="6" class="empty">{{ovResRows.length?'无匹配结果':'暂无数据'}}</td></tr>
            </tbody>
          </table></div>
          <x-pager :total="ovResRows.length" v-model:page="pageRes" v-model:size="pageSizeRes"/>
        </div>

        <div class="card" v-if="ovReg.length">
          <h3>区域合伙人佣金一览（{{ovRegRows.length}} 人）
            <span style="float:right;font-weight:400;display:flex;gap:8px;align-items:center">
              <input type="text" v-model="fRegName" placeholder="搜索合伙人" style="width:150px">
              <button class="btn btn-sm" @click="exportOv('reg')">导出</button>
            </span>
          </h3>
          <div class="table-wrap"><table class="grid rc-comm">
            <thead><tr><th style="width:56px">序号</th><th>合伙人</th><th>累计总佣金</th><th>已支付</th><th>质押</th><th>待支付</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in ovRegPaged" :key="r.p.id"><td data-label="序号">{{(pageReg-1)*pageSizeReg+i+1}}</td><td data-label="合伙人">{{r.p.name}}</td>
                <td class="num money" data-label="累计总佣金">{{fmt(r.c && r.c.earned)}}</td>
                <td class="num money" data-label="已支付">{{fmt(r.c && r.c.paid)}}</td>
                <td class="num money" data-label="质押">{{fmt(r.c && r.c.pledge)}}</td>
                <td class="num money red" data-label="待支付">{{fmt(r.c && r.c.payable)}}</td></tr>
              <tr v-if="!ovRegPaged.length"><td colspan="6" class="empty">{{ovRegRows.length?'无匹配结果':'暂无数据'}}</td></tr>
            </tbody>
          </table></div>
          <x-pager :total="ovRegRows.length" v-model:page="pageReg" v-model:size="pageSizeReg"/>
        </div>
        <div class="empty" v-if="!ovRes.length && !ovReg.length">暂无合伙人佣金数据</div>
      </template>

      <!-- 合伙人：佣金账户（接收人或管理者自由切换） -->
      <template v-else-if="renderRole==='resource' || renderRole==='region'">
        <div class="card" v-if="activePartner">
          <h3>{{activePartner.name}}（{{activeType}}合伙人）佣金账户</h3>
          <div class="stat-grid">
            <div class="stat-card"><div class="t">累计总佣金(含质押)</div><div class="v money">{{fmt(commission && commission.earned)}}</div></div>
            <div class="stat-card c2"><div class="t">累计已支付</div><div class="v money">{{fmt(commission && commission.paid)}}</div></div>
            <div class="stat-card c3"><div class="t">质押佣金</div><div class="v money">{{fmt(commission && commission.pledge)}}</div></div>
            <div class="stat-card c4"><div class="t">待支付佣金</div><div class="v money red">{{fmt(commission && commission.payable)}}</div></div>
          </div>
        </div>

        <div class="card" v-if="activePartner && custLines.length">
          <h3>客户明细（{{custLines.length}} 个）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>客户名</th><th>资源级别</th></tr></thead>
            <tbody>
              <tr v-for="(c,i) in custLines"><td data-label="序号">{{i+1}}</td><td data-label="客户名">{{c.name}}</td><td data-label="资源级别">{{c.level}} 级</td></tr>
            </tbody>
          </table></div>
        </div>

        <div class="card" v-if="activePartner && pledges.length">
          <h3>质押佣金明细（{{pledges.length}} 条）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>客户名</th><th>销售净额</th><th>对应佣金</th><th>质押原因</th><th>完成时间</th></tr></thead>
            <tbody>
              <tr v-for="(p,i) in pledges"><td data-label="序号">{{i+1}}</td><td data-label="客户名">{{p.custName}}</td><td class="num money" data-label="销售净额">{{fmt(p.net)}}</td><td class="num money" data-label="对应佣金">{{fmt(p.commission)}}</td><td data-label="质押原因">{{p.reasons.join('、')}}</td><td data-label="完成时间">{{p.finishTime}}</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="empty" v-if="!activePartner">请在上方选择合伙人</div>
        <div class="empty" v-else-if="!custLines.length && !pledges.length">暂无佣金数据</div>
      </template>

      <div class="empty" v-else>未知报表类型：{{renderRole}}</div>
    </template>
  </div>`
};
