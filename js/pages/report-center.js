/* 报表中心：接收人登录后查看属于自己的报表（服务端按 profile 裁剪，客户端只渲染） */
window.Pages = window.Pages || {};

Pages['page-reportcenter'] = {
  data() {
    return {
      loading: true, err: '', role: '', type: '', partner: null,
      db: null, partial: null, generatedAt: ''
    };
  },
  async created() {
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
    S() {
      if (this.partial) return ComputeCore.makeCompute(this.partial);
      if (this.db) return ComputeCore.makeCompute(this.db);
      return null;
    },
    pid() { return this.partner ? this.partner.id : null; },
    ptype() { return this.type === '区域' ? '区域' : '资源'; },
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
    arrears() { return this.S ? this.S.payAlerts() : []; },
    stock() { return this.S ? this.S.stockAlerts() : []; },
    stats() { return this.S ? this.S.stats() : null; }
  },
  methods: {
    fmt(n) {
      return ComputeCore.U.round2(Number(n) || 0).toLocaleString('zh-CN',
        { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  },
  template: `
  <div>
    <div class="page-title">我的报表</div>
    <div v-if="loading" class="muted" style="padding:20px 0">正在加载报表…</div>
    <div v-else-if="err" class="gate-err" style="white-space:pre-line">{{err}}</div>
    <template v-else>
      <div class="muted" style="margin-bottom:10px">生成时间：{{generatedAt}}</div>

      <!-- 合伙人：佣金账户 -->
      <template v-if="role==='resource' || role==='region'">
        <div class="card" v-if="partner">
          <h3>{{partner.name}}（{{type}}合伙人）佣金账户</h3>
          <div class="stat-grid">
            <div class="stat-card"><div class="t">累计总佣金(含质押)</div><div class="v money">{{fmt(commission && commission.earned)}}</div></div>
            <div class="stat-card c2"><div class="t">累计已支付</div><div class="v money">{{fmt(commission && commission.paid)}}</div></div>
            <div class="stat-card c3"><div class="t">质押佣金</div><div class="v money">{{fmt(commission && commission.pledge)}}</div></div>
            <div class="stat-card c4"><div class="t">待支付佣金</div><div class="v money red">{{fmt(commission && commission.payable)}}</div></div>
          </div>
        </div>

        <div class="card" v-if="custLines.length">
          <h3>客户明细（{{custLines.length}} 个）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>客户名</th><th>资源级别</th></tr></thead>
            <tbody>
              <tr v-for="(c,i) in custLines"><td>{{i+1}}</td><td>{{c.name}}</td><td>{{c.level}} 级</td></tr>
            </tbody>
          </table></div>
        </div>

        <div class="card" v-if="pledges.length">
          <h3>质押佣金明细（{{pledges.length}} 条）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>客户名</th><th>销售净额</th><th>对应佣金</th><th>质押原因</th><th>完成时间</th></tr></thead>
            <tbody>
              <tr v-for="(p,i) in pledges"><td>{{i+1}}</td><td>{{p.custName}}</td><td class="num money">{{fmt(p.net)}}</td><td class="num money">{{fmt(p.commission)}}</td><td>{{p.reasons.join('、')}}</td><td>{{p.finishTime}}</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="empty" v-if="!custLines.length && !pledges.length">暂无佣金数据</div>
      </template>

      <!-- 对账人：欠款 -->
      <template v-else-if="role==='arrears'">
        <div class="card" v-if="arrears.length">
          <h3>欠款预警（{{arrears.length}} 户）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>客户名</th><th>账期</th><th>应付日期</th><th>超期天数</th><th>超期未付</th><th>累计未付</th><th>备注</th></tr></thead>
            <tbody>
              <tr v-for="(a,i) in arrears"><td>{{i+1}}</td><td>{{a.name}}</td><td>{{a.period}}</td><td>{{a.due}}</td><td class="num">{{a.days}}</td><td class="num money red">{{fmt(a.amt)}}</td><td class="num money">{{fmt(a.total)}}</td><td>{{a.remark}}</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="empty" v-else>暂无超期欠款</div>
      </template>

      <!-- 库管：库存 -->
      <template v-else-if="role==='stock'">
        <div class="card" v-if="stock.length">
          <h3>库存预警（{{stock.length}} 个）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>序号</th><th>商品名</th><th>库存</th><th>最低</th><th>缺口</th></tr></thead>
            <tbody>
              <tr v-for="(s,i) in stock"><td>{{i+1}}</td><td>{{s.name}}</td><td class="num">{{s.qty}}</td><td class="num">{{s.min}}</td><td class="num money red">{{s.min - s.qty}}</td></tr>
            </tbody>
          </table></div>
        </div>
        <div class="empty" v-else>库存均充足</div>
      </template>

      <!-- 管理者：经营 -->
      <template v-else-if="role==='manager'">
        <div class="card" v-if="stats">
          <h3>经营概况</h3>
          <div class="stat-grid">
            <div class="stat-card"><div class="t">客户总数</div><div class="v">{{stats.custTotal}}</div></div>
            <div class="stat-card c2"><div class="t">库存货值</div><div class="v money">{{fmt(stats.invValue)}}</div></div>
            <div class="stat-card c3"><div class="t">累计销售额</div><div class="v money">{{fmt(stats.totalSales)}}</div></div>
            <div class="stat-card c4"><div class="t">累计收款</div><div class="v money">{{fmt(stats.totalReceipts)}}</div></div>
          </div>
          <div class="stat-grid" style="margin-top:10px">
            <div class="stat-card"><div class="t">资源佣金</div><div class="v money">{{fmt(stats.resComm)}}</div></div>
            <div class="stat-card c2"><div class="t">区域佣金</div><div class="v money">{{fmt(stats.regComm)}}</div></div>
            <div class="stat-card c3"><div class="t">税费成本</div><div class="v money">{{fmt(stats.taxCost)}}</div></div>
            <div class="stat-card c4"><div class="t">配送费成本</div><div class="v money">{{fmt(stats.deliveryCost)}}</div></div>
          </div>
        </div>
        <div class="card" v-if="arrears.length">
          <h3>欠款预警（{{arrears.length}} 户）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>客户名</th><th>超期天数</th><th>超期未付</th><th>累计未付</th></tr></thead>
            <tbody><tr v-for="a in arrears"><td>{{a.name}}</td><td class="num">{{a.days}}</td><td class="num money red">{{fmt(a.amt)}}</td><td class="num money">{{fmt(a.total)}}</td></tr></tbody>
          </table></div>
        </div>
        <div class="card" v-if="stock.length">
          <h3>库存预警（{{stock.length}} 个）</h3>
          <div class="table-wrap"><table class="grid">
            <thead><tr><th>商品名</th><th>库存</th><th>最低</th><th>缺口</th></tr></thead>
            <tbody><tr v-for="s in stock"><td>{{s.name}}</td><td class="num">{{s.qty}}</td><td class="num">{{s.min}}</td><td class="num money red">{{s.min - s.qty}}</td></tr></tbody>
          </table></div>
        </div>
      </template>

      <div class="empty" v-else>未知报表类型：{{role}}</div>
    </template>
  </div>`
};
