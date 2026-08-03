/* 运营报表：经营总览 / 佣金统计 / 销售·采购·成本·应收明细，均支持时间范围与导出 */
window.Pages = window.Pages || {};

Pages['page-report'] = {
  data() {
    return { d1: U.addDays(U.today(), -29), d2: U.today() };
  },
  computed: {
    S() { return window.S; },
    doneSales() { return S.completedSalesIn(this.d1, this.d2); },
    overview() {
      const sales = this.doneSales;
      const gross = U.round2(sales.reduce((a, s) => a + s.total, 0));
      const returned = U.round2(S.db.returns.filter(r => U.inRange(r.createTime, this.d1, this.d2)).reduce((a, r) => a + r.total, 0));
      const net = U.round2(sales.reduce((a, s) => a + S.saleNet(s), 0));
      const cost = U.round2(sales.reduce((a, s) => a + S.saleCost(s), 0));
      /* 税点成本：仅计入成本侧，不影响销售额与佣金基数 */
      const taxCost = U.round2(sales.reduce((a, s) => a + S.saleTaxCost(s), 0));
      const deliveryCost = U.round2(sales.reduce((a, s) => a + S.saleDeliveryCost(s), 0));
      const profit = U.round2(net - cost - taxCost - deliveryCost);
      const purchases = S.db.purchases.filter(p => U.inRange(p.inTime, this.d1, this.d2));
      const purAmt = U.round2(purchases.reduce((a, p) => a + Number(p.amount), 0));
      const purQty = purchases.reduce((a, p) => a + Number(p.qty), 0);
      const opCost = U.round2(S.db.expenses.filter(x => x.status === '已计算' && U.inRange(x.createTime, this.d1, this.d2)).reduce((a, x) => a + Number(x.amount), 0));
      const resComm = S.totalResourceCommission(this.d1, this.d2);
      const regComm = S.totalRegionCommission(this.d1, this.d2);
      const netProfit = U.round2(profit - opCost - resComm - regComm);
      return { orderCount: sales.length, gross, returned, net, cost, taxCost, deliveryCost, profit, purQty, purAmt, opCost, resComm, regComm, netProfit };
    },
    /* 佣金支付与质押总账（全期口径，含资源 + 区域合伙人） */
    payRows() {
      const out = [];
      S.db.resourcePartners.forEach(p => {
        const a = S.partnerCommissionAccount(p.id, '资源');
        if (a.earned > 0 || a.paid > 0) out.push({ type: '资源', name: p.name, ...a, cnt: S.pledgeList(p.id, '资源').length });
      });
      S.db.regionPartners.forEach(p => {
        const a = S.partnerCommissionAccount(p.id, '区域');
        if (a.earned > 0 || a.paid > 0) out.push({ type: '区域', name: p.name, ...a, cnt: S.pledgeList(p.id, '区域').length });
      });
      return out.sort((a, b) => b.earned - a.earned);
    },
    payTotal() {
      const t = { earned: 0, paid: 0, pledge: 0, payable: 0 };
      this.payRows.forEach(r => { t.earned += r.earned; t.paid += r.paid; t.pledge += r.pledge; t.payable += r.payable; });
      return { earned: U.round2(t.earned), paid: U.round2(t.paid), pledge: U.round2(t.pledge), payable: U.round2(t.payable) };
    },
    resRows() {
      const list = S.resourceCommission(this.d1, this.d2)
        .map(x => ({
          name: S.name('resourcePartners', x.partnerId), partnerId: x.partnerId,
          level: ['一级', '二级', '三级'][x.level - 1],
          custCount: x.custCount, sales: x.sales, rate: x.rate, commission: x.commission
        }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.level.localeCompare(b.level));
      /* 同一合伙人小计 */
      const out = [];
      let i = 0;
      while (i < list.length) {
        let j = i;
        while (j < list.length && list[j].partnerId === list[i].partnerId) j++;
        const seg = list.slice(i, j);
        seg.forEach(r => out.push({ ...r, isSub: false }));
        if (seg.length > 1) {
          out.push({
            name: seg[0].name + '（合计）', level: '-', custCount: '-',
            sales: U.round2(seg.reduce((a, r) => a + r.sales, 0)), rate: '-',
            commission: U.round2(seg.reduce((a, r) => a + r.commission, 0)), isSub: true
          });
        }
        i = j;
      }
      return out;
    },
    resTotal() { return U.round2(this.resRows.filter(r => !r.isSub).reduce((a, r) => a + r.commission, 0)); },
    regRows() {
      return S.regionCommission(this.d1, this.d2).map(x => ({
        name: S.name('regionPartners', x.partnerId),
        region: S.name('regions', (S.byId('regionPartners', x.partnerId) || {}).regionId),
        custCount: x.custCount, sales: x.sales, rate: x.rate, commission: x.commission
      }));
    },
    regTotal() { return U.round2(this.regRows.reduce((a, r) => a + r.commission, 0)); },
    goodsRows() {
      const acc = {};
      this.doneSales.forEach(s => (s.items || []).forEach((it, idx) => {
        const g = S.byId('goods', it.goodsId); if (!g) return;
        const netQty = it.qty - S.saleReturnedQty(s.id, idx);
        if (!acc[g.id]) acc[g.id] = { name: g.name, type: S.name('goodsTypes', g.typeId), qty: 0, amt: 0, cost: 0 };
        acc[g.id].qty += netQty;
        acc[g.id].amt += netQty * it.price;
        acc[g.id].cost += netQty * g.purchasePrice;
      }));
      return Object.values(acc).map(r => ({
        ...r, amt: U.round2(r.amt), cost: U.round2(r.cost), profit: U.round2(r.amt - r.cost)
      })).sort((a, b) => b.amt - a.amt);
    },
    supplierRows() {
      const acc = {};
      S.db.purchases.filter(p => U.inRange(p.inTime, this.d1, this.d2)).forEach(p => {
        const n = S.name('suppliers', p.supplierId);
        if (!acc[n]) acc[n] = { name: n, qty: 0, amt: 0, count: 0 };
        acc[n].qty += Number(p.qty); acc[n].amt += Number(p.amount); acc[n].count++;
      });
      return Object.values(acc).map(r => ({ ...r, amt: U.round2(r.amt) })).sort((a, b) => b.amt - a.amt);
    },
    expenseRows() {
      const acc = {};
      S.db.expenses.filter(x => x.status === '已计算' && U.inRange(x.createTime, this.d1, this.d2)).forEach(x => {
        const n = S.name('expenseCats', x.catId);
        if (!acc[n]) acc[n] = { name: n, amt: 0, count: 0 };
        acc[n].amt += Number(x.amount); acc[n].count++;
      });
      return Object.values(acc).map(r => ({ ...r, amt: U.round2(r.amt) })).sort((a, b) => b.amt - a.amt);
    },
    arRows() {
      return S.db.customers
        .map(c => ({ name: c.name, arrears: S.custArrears(c.id), overdue: S.custOverdueArrears(c.id) }))
        .filter(r => r.arrears > 0)
        .sort((a, b) => b.arrears - a.arrears);
    }
  },
  methods: {
    fmtMoney: U.fmtMoney, fmtNum: U.fmtNum,
    exportRes() {
      U.exportExcel('资源合伙人佣金表.xlsx', this.resRows.map((r, i) => ({
        '序号': i + 1, '资源合伙人': r.name, '级别': r.level, '客户数': r.custCount,
        '销售净额': r.sales, '佣金比例(%)': r.rate, '佣金': r.commission
      })));
    },
    exportReg() {
      U.exportExcel('区域合伙人佣金表.xlsx', this.regRows.map((r, i) => ({
        '序号': i + 1, '区域合伙人': r.name, '负责区域': r.region, '客户数': r.custCount,
        '销售净额': r.sales, '佣金比例(%)': r.rate, '佣金': r.commission
      })));
    },
    exportGoods() {
      U.exportExcel('商品销售汇总.xlsx', this.goodsRows.map((r, i) => ({
        '序号': i + 1, '商品名称': r.name, '商品分类': r.type, '销量(净)': r.qty,
        '销售额(净)': r.amt, '销售成本': r.cost, '毛利': r.profit
      })));
    },
    exportSupplier() {
      U.exportExcel('供应商采购汇总.xlsx', this.supplierRows.map((r, i) => ({
        '序号': i + 1, '供应商': r.name, '采购单数': r.count, '采购数量': r.qty, '采购金额': r.amt
      })));
    },
    exportExpense() {
      U.exportExcel('运营成本汇总.xlsx', this.expenseRows.map((r, i) => ({
        '序号': i + 1, '类目': r.name, '笔数': r.count, '金额': r.amt
      })));
    },
    exportPay() {
      U.exportExcel('佣金支付与质押统计.xlsx', this.payRows.map((r, i) => ({
        '序号': i + 1, '类型': r.type + '合伙人', '姓名': r.name,
        '累计应得佣金': r.earned, '累计已支付': r.paid, '质押中(暂扣)': r.pledge,
        '质押单数': r.cnt, '当前可支付': r.payable, '未支付合计': r.unpaid
      })));
    },
    exportAR() {
      U.exportExcel('应收账款表.xlsx', this.arRows.map((r, i) => ({
        '序号': i + 1, '客户名称': r.name, '累计未支付金额': r.arrears, '其中超期金额': r.overdue
      })));
    }
  },
  template: `
  <div>
    <div class="page-title">运营报表</div>
    <div class="card">
      <div class="toolbar">
        <label>统计时间范围</label>
        <input type="date" v-model="d1"> - <input type="date" v-model="d2">
        <span class="muted">所有报表均按该时间范围统计（销售按完成时间、采购按入库时间、运营支出按创建时间）</span>
      </div>
    </div>

    <!-- 经营总览 -->
    <div class="stat-grid">
      <div class="stat-card"><div class="t">销售单数 / 净销售额</div><div class="v money">{{overview.orderCount}} 单 / ￥{{fmtMoney(overview.net)}}</div>
        <div class="sub">销售总额 ￥{{fmtMoney(overview.gross)}} ｜ 退货 ￥{{fmtMoney(overview.returned)}}</div></div>
      <div class="stat-card c2"><div class="t">销售毛利</div><div class="v money">￥{{fmtMoney(overview.profit)}}</div>
        <div class="sub">销售成本（按采购价）￥{{fmtMoney(overview.cost)}} ｜ 税点成本 ￥{{fmtMoney(overview.taxCost)}}<br>毛利 = 净销售额 - 销售成本 - 税点成本</div></div>
      <div class="stat-card c3"><div class="t">采购 / 运营支出</div><div class="v money">￥{{fmtMoney(overview.purAmt)}}</div>
        <div class="sub">采购 {{fmtNum(overview.purQty)}} 件 ｜ 运营支出（已计算）￥{{fmtMoney(overview.opCost)}}</div></div>
      <div class="stat-card c4"><div class="t">佣金 / 净利润</div><div class="v money" :class="overview.netProfit>=0?'green-t':'red'">￥{{fmtMoney(overview.netProfit)}}</div>
        <div class="sub">资源佣金 ￥{{fmtMoney(overview.resComm)}} ｜ 区域佣金 ￥{{fmtMoney(overview.regComm)}}<br>净利润 = 毛利 - 运营支出 - 佣金</div></div>
    </div>

    <!-- 资源合伙人佣金 -->
    <div class="card">
      <h3>资源合伙人佣金统计 <span class="muted" style="font-weight:400">同一合伙人可同时担任一/二/三级，分级列示并小计</span>
        <button class="btn btn-sm" @click="exportRes">导出</button></h3>
      <table class="grid">
        <thead><tr><th>序号</th><th>资源合伙人</th><th>级别</th><th class="num">客户数</th><th class="num">销售净额</th><th class="num">佣金比例</th><th class="num">佣金</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in resRows" :style="r.isSub?'background:#f8fafc;font-weight:700':''">
            <td>{{r.isSub?'':i+1}}</td><td>{{r.name}}</td><td>{{r.level}}</td>
            <td class="num">{{r.custCount}}</td><td class="num money">{{fmtMoney(r.sales)}}</td>
            <td class="num">{{r.rate==='-'?'-':r.rate+'%'}}</td><td class="num money">{{fmtMoney(r.commission)}}</td>
          </tr>
          <tr v-if="!resRows.length"><td colspan="7" class="empty">该时间范围内暂无资源佣金</td></tr>
          <tr v-if="resRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="6" style="text-align:right">资源佣金总计</td><td class="num money red">￥{{fmtMoney(resTotal)}}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 区域合伙人佣金 -->
    <div class="card">
      <h3>区域合伙人佣金统计 <button class="btn btn-sm" @click="exportReg">导出</button></h3>
      <table class="grid">
        <thead><tr><th>序号</th><th>区域合伙人</th><th>负责区域</th><th class="num">客户数</th><th class="num">销售净额</th><th class="num">佣金比例</th><th class="num">佣金</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in regRows">
            <td>{{i+1}}</td><td>{{r.name}}</td><td>{{r.region||'-'}}</td>
            <td class="num">{{r.custCount}}</td><td class="num money">{{fmtMoney(r.sales)}}</td>
            <td class="num">{{r.rate}}%</td><td class="num money">{{fmtMoney(r.commission)}}</td>
          </tr>
          <tr v-if="!regRows.length"><td colspan="7" class="empty">该时间范围内暂无区域佣金</td></tr>
          <tr v-if="regRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="6" style="text-align:right">区域佣金总计</td><td class="num money red">￥{{fmtMoney(regTotal)}}</td></tr>
        </tbody>
      </table>
    </div>

    <!-- 佣金支付与质押统计 -->
    <div class="card">
      <h3>佣金支付与质押统计 <span class="muted" style="font-weight:400">全期口径；质押 = 每个客户最后一单佣金 + 未支付货款单佣金，防退货/跑单超额</span>
        <button class="btn btn-sm" @click="exportPay">导出</button></h3>
      <table class="grid">
        <thead><tr><th>序号</th><th>类型</th><th>姓名</th><th class="num">累计应得佣金</th><th class="num">累计已支付</th>
          <th class="num">质押中（暂扣）</th><th class="num">质押单数</th><th class="num">当前可支付</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in payRows" :key="r.type+r.name">
            <td>{{i+1}}</td>
            <td><span class="tag" :class="r.type==='资源'?'tag-blue':'tag-green'">{{r.type}}合伙人</span></td>
            <td>{{r.name}}</td>
            <td class="num money">{{fmtMoney(r.earned)}}</td>
            <td class="num money green-t">{{fmtMoney(r.paid)}}</td>
            <td class="num money orange">{{fmtMoney(r.pledge)}}</td>
            <td class="num">{{r.cnt}}</td>
            <td class="num money"><b>{{fmtMoney(r.payable)}}</b></td>
          </tr>
          <tr v-if="!payRows.length"><td colspan="8" class="empty">暂无佣金数据</td></tr>
          <tr v-if="payRows.length" style="background:#eff6ff;font-weight:700">
            <td colspan="3" style="text-align:right">合计</td>
            <td class="num money">￥{{fmtMoney(payTotal.earned)}}</td>
            <td class="num money green-t">￥{{fmtMoney(payTotal.paid)}}</td>
            <td class="num money orange">￥{{fmtMoney(payTotal.pledge)}}</td>
            <td class="num">-</td>
            <td class="num money red">￥{{fmtMoney(payTotal.payable)}}</td>
          </tr>
        </tbody>
      </table>
      <div class="form-hint">佣金支付操作入口在「合伙人管理 - 详情」内，支持记录清单与累计已支付统计。</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <!-- 商品销售汇总 -->
      <div class="card" style="margin-bottom:0">
        <h3>商品销售汇总（净额口径）<button class="btn btn-sm" @click="exportGoods">导出</button></h3>
        <table class="grid">
          <thead><tr><th>商品</th><th>分类</th><th class="num">销量</th><th class="num">销售额</th><th class="num">毛利</th></tr></thead>
          <tbody>
            <tr v-for="r in goodsRows"><td>{{r.name}}</td><td>{{r.type}}</td><td class="num">{{r.qty}}</td>
              <td class="num money">{{fmtMoney(r.amt)}}</td><td class="num money green-t">{{fmtMoney(r.profit)}}</td></tr>
            <tr v-if="!goodsRows.length"><td colspan="5" class="empty">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
      <!-- 供应商采购汇总 -->
      <div class="card" style="margin-bottom:0">
        <h3>供应商采购汇总 <button class="btn btn-sm" @click="exportSupplier">导出</button></h3>
        <table class="grid">
          <thead><tr><th>供应商</th><th class="num">采购单数</th><th class="num">采购数量</th><th class="num">采购金额</th></tr></thead>
          <tbody>
            <tr v-for="r in supplierRows"><td>{{r.name}}</td><td class="num">{{r.count}}</td>
              <td class="num">{{fmtNum(r.qty)}}</td><td class="num money">{{fmtMoney(r.amt)}}</td></tr>
            <tr v-if="!supplierRows.length"><td colspan="4" class="empty">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
      <!-- 运营成本 -->
      <div class="card" style="margin-bottom:0">
        <h3>运营成本汇总（已计算）<button class="btn btn-sm" @click="exportExpense">导出</button></h3>
        <table class="grid">
          <thead><tr><th>类目</th><th class="num">笔数</th><th class="num">金额</th></tr></thead>
          <tbody>
            <tr v-for="r in expenseRows"><td>{{r.name}}</td><td class="num">{{r.count}}</td><td class="num money">{{fmtMoney(r.amt)}}</td></tr>
            <tr v-if="!expenseRows.length"><td colspan="3" class="empty">暂无数据</td></tr>
          </tbody>
        </table>
      </div>
      <!-- 应收账款 -->
      <div class="card" style="margin-bottom:0">
        <h3>应收账款（全部未支付，不限时间）<button class="btn btn-sm" @click="exportAR">导出</button></h3>
        <table class="grid">
          <thead><tr><th>客户</th><th class="num">累计未支付</th><th class="num">其中超期</th></tr></thead>
          <tbody>
            <tr v-for="r in arRows"><td>{{r.name}}</td><td class="num money">{{fmtMoney(r.arrears)}}</td>
              <td class="num money" :class="{red:r.overdue>0}">{{fmtMoney(r.overdue)}}</td></tr>
            <tr v-if="!arRows.length"><td colspan="3" class="empty">暂无应收账款</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>`
};
