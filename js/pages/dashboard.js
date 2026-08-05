/* 仪表盘：全局统计 / 横向分析 / 纵向分析 / 预警事项 */
window.Pages = window.Pages || {};

Pages['page-dashboard'] = {
  data() {
    return {
      hd1: U.addDays(U.today(), -29), hd2: U.today(), metric: '销售金额',
      vd1: U.addDays(U.today(), -29), vd2: U.today(), rank: '在售商品销量排名',
      showMore: false, expanded: { stock: false, pay: false, wh: false },
      metricTotal: 0,
      metrics: ['销售数量', '销售金额', '新增客户数量', '各类型客户数量', '各级别客户数量', '资源合伙人数量', '区域合伙人数量', '收款金额', '欠款金额', '支出金额'],
      ranks: ['在售商品销量排名', '客户销量排名',
        '资源合伙人累计总销量排名', '一级资源合伙人销量排名', '二级资源合伙人销量排名', '三级资源合伙人销量排名',
        '区域合伙人销量排名', '投诉排名', '投诉类型排名',
        '供应商采购量排名', '商品分类销量排名', '客户类型销量排名', '客户级别销量排名', '区域客户数量排名', '区域销量排名',
        '财务类目支出排名']
    };
  },
  computed: {
    S() { return window.S; },
    metricOpts() { return this.metrics.map(m => ({ value: m, label: m })); },
    rankOpts() { return this.ranks.map(r => ({ value: r, label: r })); },
    metricIsMoney() { return ['销售金额', '收款金额', '欠款金额', '支出金额'].includes(this.metric); },
    rankTotal() {
      const rows = this.ranking.rows;
      return { qty: rows.reduce((a, r) => a + r.qty, 0), amt: U.round2(rows.reduce((a, r) => a + r.amt, 0)) };
    },
    stats() {
      const db = S.db;
      const en = c => db[c].filter(x => x.status === '已启用');
      /* 商品 */
      const goodsByType = {};
      en('goods').forEach(g => { const n = S.name('goodsTypes', g.typeId); goodsByType[n] = (goodsByType[n] || 0) + 1; });
      /* 客户 */
      const custs = en('customers');
      const grp = (key, coll) => {
        const m = {};
        custs.forEach(c => { const n = S.name(coll, c[key]) || '未设置'; m[n] = (m[n] || 0) + 1; });
        return m;
      };
      /* 库存 */
      let invQty = 0, invCost = 0, invValue = 0;
      db.stocks.forEach(st => {
        const g = S.byId('goods', st.goodsId); if (!g) return;
        invQty += st.qty; invCost += st.qty * g.purchasePrice; invValue += st.qty * g.retailPrice;
      });
      /* 库存按类型 */
      const invByType = {};
      db.stocks.forEach(st => {
        const g = S.byId('goods', st.goodsId); if (!g) return;
        const n = S.name('goodsTypes', g.typeId);
        invByType[n] = (invByType[n] || 0) + st.qty;
      });
      /* 仓库月租（仅作参考展示，固定成本已并入日常运营） */
      const rentSum = U.round2(en('warehouses').reduce((a, w) => a + Number(w.rent || 0), 0));
      /* 累计销售/成本 */
      const totalSales = U.round2(db.sales.filter(s => s.status === '已完成').reduce((a, s) => a + S.saleNet(s), 0));
      const opCost = U.round2(db.expenses.filter(x => x.status === '已计算').reduce((a, x) => a + Number(x.amount), 0));
      const resComm = S.totalResourceCommission(null, null);
      const regComm = S.totalRegionCommission(null, null);
      const taxCost = S.totalTaxCost(null, null);
      const deliveryCost = S.totalDeliveryCost(null, null);
      /* 投诉 */
      const cmpByType = {};
      db.complaints.forEach(c => { const n = S.name('complaintTypes', c.typeId); cmpByType[n] = (cmpByType[n] || 0) + 1; });
      const rp = S.resourcePartnerLevelCounts();
      const totalArrears = U.round2(db.customers.reduce((a, c) => a + S.custArrears(c.id), 0));
      return {
        goodsTotal: en('goods').length, goodsByType,
        supplierTotal: en('suppliers').length,
        custTotal: custs.length,
        custByType: grp('typeId', 'custTypes'), custByLevel: grp('levelId', 'custLevels'), custByRegion: grp('regionId', 'regions'),
        rp, regionPartnerTotal: en('regionPartners').length,
        invQty, invCost: U.round2(invCost), invValue: U.round2(invValue), invProfit: U.round2(invValue - invCost), invByType,
        rentSum,
        totalSales, totalCost: U.round2(opCost + resComm + regComm + taxCost + deliveryCost), opCost, resComm, regComm, taxCost, deliveryCost,
        totalExpense: opCost, totalArrears,
        cmpTotal: db.complaints.length, cmpByType,
        totalPurchase: U.round2(db.purchases.reduce((a, p) => a + Number(p.amount), 0)),
        totalReceipts: U.round2(db.sales.filter(s => s.payStatus === '已支付').reduce((a, s) => a + (Number(s.actualPaid) || S.salePayable(s)), 0)),
        receiptByMethod: (() => {
          const m = {};
          db.sales.filter(s => s.payStatus === '已支付').forEach(s => {
            const k = s.payMethod || '未设置';
            m[k] = U.round2((m[k] || 0) + (Number(s.actualPaid) || S.salePayable(s)));
          });
          return m;
        })(),
        totalCapital: S.totalCapitalInjected(),
        whTotal: en('warehouses').length
      };
    },
    /* ---------- 预警 ---------- */
    stockAlerts() {
      const byGoods = {};
      S.db.stocks.forEach(st => { byGoods[st.goodsId] = (byGoods[st.goodsId] || 0) + st.qty; });
      return S.enabled('goods')
        .map(g => ({ name: g.name, qty: byGoods[g.id] || 0, min: g.minStock || 0 }))
        .filter(r => r.qty < r.min)
        .sort((a, b) => (b.min - b.qty) - (a.min - a.qty));
    },
    whAlerts() {
      return S.enabled('warehouses')
        .filter(w => w.expireDate)
        .map(w => ({ ...w, days: U.daysBetween(U.today(), w.expireDate) }))
        .sort((a, b) => a.days - b.days);
    },
    payAlerts() {
      return S.db.customers
        .map(c => {
          /* 该客户名下所有已超期未支付的销售单 */
          const od = S.db.sales.filter(s => s.customerId === c.id && s.status === '已完成'
            && s.payStatus !== '已支付' && S.saleOverdueDays(s) > 0);
          let due = '', maxDays = 0;
          od.forEach(s => {
            const d = S.saleDueDate(s);
            if (!due || d < due) due = d;
            const n = S.saleOverdueDays(s);
            if (n > maxDays) maxDays = n;
          });
          const cyc = c.payCycle || '现结';
          const period = (cyc === '现结' || !c.payDay) ? cyc : (cyc + '（' + c.payDay + '号）');
          return {
            name: c.name, amt: S.custOverdueArrears(c.id), total: S.custArrears(c.id),
            period, due, days: maxDays, cnt: od.length
          };
        })
        .filter(r => r.amt > 0)
        .sort((a, b) => b.amt - a.amt);
    },
    /* ---------- 纵向分析 ---------- */
    ranking() {
      const d1 = this.vd1, d2 = this.vd2, db = S.db;
      const doneSales = S.completedSalesIn(d1, d2);
      const acc = {};
      const add = (key, qty, amt) => {
        if (!key) key = '未设置';
        if (!acc[key]) acc[key] = { name: key, qty: 0, amt: 0 };
        acc[key].qty += qty; acc[key].amt += amt;
      };
      const eachItem = (fn) => doneSales.forEach(s => (s.items || []).forEach((it, idx) => {
        const netQty = it.qty - S.saleReturnedQty(s.id, idx);
        fn(s, it, netQty, U.round2(netQty * it.price));
      }));
      let cols = [{ k: 'name', label: '名称' }, { k: 'qty', label: '销量', num: 1 }, { k: 'amt', label: '销售额', num: 1, money: 1 }];
      switch (this.rank) {
        case '在售商品销量排名':
          cols[0].label = '商品名称';
          eachItem((s, it, q, a) => add(S.name('goods', it.goodsId), q, a)); break;
        case '客户销量排名':
          cols[0].label = '客户名称';
          eachItem((s, it, q, a) => add(S.name('customers', s.customerId), q, a)); break;
        case '资源合伙人累计总销量排名':
          /* 一个合伙人在同一张单上可能同时挂多个级别槽位，按人去重只计一次 */
          cols[0].label = '资源合伙人';
          eachItem((s, it, q, a) => {
            const c = S.byId('customers', s.customerId); if (!c) return;
            const seen = {};
            [1, 2, 3].forEach(L => {
              const pid = c['r' + L];
              if (!pid || seen[pid]) return;
              seen[pid] = 1;
              add(S.name('resourcePartners', pid), q, a);
            });
          }); break;
        case '一级资源合伙人销量排名':
        case '二级资源合伙人销量排名':
        case '三级资源合伙人销量排名': {
          const L = { '一': 1, '二': 2, '三': 3 }[this.rank.charAt(0)];
          cols[0].label = ['一级', '二级', '三级'][L - 1] + '资源合伙人';
          eachItem((s, it, q, a) => {
            const c = S.byId('customers', s.customerId); if (!c) return;
            if (c['r' + L]) add(S.name('resourcePartners', c['r' + L]), q, a);
          }); break;
        }
        case '区域合伙人销量排名':
          cols[0].label = '区域合伙人';
          eachItem((s, it, q, a) => {
            const c = S.byId('customers', s.customerId);
            if (c && c.regionPartnerId) add(S.name('regionPartners', c.regionPartnerId), q, a);
          }); break;
        case '投诉排名':
          cols = [{ k: 'name', label: '客户名称' }, { k: 'qty', label: '投诉次数', num: 1 }];
          db.complaints.filter(x => U.inRange(x.time, d1, d2))
            .forEach(x => add(S.name('customers', x.customerId), 1, 0)); break;
        case '投诉类型排名':
          cols = [{ k: 'name', label: '投诉类型' }, { k: 'qty', label: '投诉次数', num: 1 }];
          db.complaints.filter(x => U.inRange(x.time, d1, d2))
            .forEach(x => add(S.name('complaintTypes', x.typeId), 1, 0)); break;
        case '供应商采购量排名':
          cols = [{ k: 'name', label: '供应商' }, { k: 'qty', label: '采购数量', num: 1 }, { k: 'amt', label: '采购金额', num: 1, money: 1 }];
          db.purchases.filter(p => U.inRange(p.inTime, d1, d2))
            .forEach(p => add(S.name('suppliers', p.supplierId), Number(p.qty), Number(p.amount))); break;
        case '商品分类销量排名':
          cols[0].label = '商品分类';
          eachItem((s, it, q, a) => { const g = S.byId('goods', it.goodsId); add(g ? S.name('goodsTypes', g.typeId) : '', q, a); }); break;
        case '客户类型销量排名':
          cols[0].label = '客户类型';
          eachItem((s, it, q, a) => { const c = S.byId('customers', s.customerId); add(c ? S.name('custTypes', c.typeId) : '', q, a); }); break;
        case '客户级别销量排名':
          cols[0].label = '客户级别';
          eachItem((s, it, q, a) => { const c = S.byId('customers', s.customerId); add(c ? S.name('custLevels', c.levelId) : '', q, a); }); break;
        case '区域客户数量排名':
          cols = [{ k: 'name', label: '区域' }, { k: 'qty', label: '客户数量（截至结束日期）', num: 1 }];
          db.customers.filter(c => c.status === '已启用' && U.ymd(c.createTime) <= (d2 || '9999'))
            .forEach(c => add(S.name('regions', c.regionId), 1, 0)); break;
        case '区域销量排名':
          cols[0].label = '区域';
          eachItem((s, it, q, a) => { const c = S.byId('customers', s.customerId); add(c ? S.name('regions', c.regionId) : '', q, a); }); break;
        case '财务类目支出排名':
          cols = [{ k: 'name', label: '支出类目' }, { k: 'qty', label: '笔数', num: 1 }, { k: 'amt', label: '支出金额', num: 1, money: 1 }];
          db.expenses.filter(x => x.status === '已计算' && U.inRange(x.createTime, d1, d2))
            .forEach(x => add(S.name('expenseCats', x.catId), 1, Number(x.amount))); break;
      }
      const rows = Object.values(acc)
        .map(r => ({ ...r, amt: U.round2(r.amt) }))
        .sort((a, b) => (b.amt - a.amt) || (b.qty - a.qty));
      return { cols, rows };
    },
    top10() { return this.ranking.rows.slice(0, 10); }
  },
  methods: {
    fmtMoney: U.fmtMoney, fmtNum: U.fmtNum,
    go(key) { if (this.$root && this.$root.go) this.$root.go(key); },
    subText(obj, unit) {
      return Object.entries(obj).map(([k, v]) => k + ' ' + v + (unit || '')).join(' ｜ ') || '暂无';
    },
    range(which, kind) {
      const t = U.today();
      if (kind === 'week') {
        const wd = (new Date(t + 'T00:00:00').getDay() + 6) % 7;
        const mon = U.addDays(t, -wd);
        this[which + '1'] = mon; this[which + '2'] = U.addDays(mon, 6);
      } else {
        const [y, m] = t.split('-');
        this[which + '1'] = y + '-' + m + '-01';
        this[which + '2'] = U.ymd(new Date(Number(y), Number(m), 0));
      }
    },
    exportRank() {
      const { cols, rows } = this.ranking;
      U.exportExcel(this.rank + '.xlsx', rows.map((r, i) => {
        const o = { '排名': i + 1 };
        cols.forEach(c => { o[c.label] = r[c.k]; });
        return o;
      }));
    },
    exportAlert(kind) {
      let name = '', rows = [], cols = [];
      if (kind === 'stock') {
        name = '库存预警.xlsx'; rows = this.stockAlerts;
        cols = [['序号', (r, i) => i + 1], ['商品名称', r => r.name], ['库存数量', r => r.qty], ['最低库存', r => r.min], ['缺口', r => r.min - r.qty]];
      } else if (kind === 'pay') {
        name = '超期未支付预警.xlsx'; rows = this.payAlerts;
        cols = [['序号', (r, i) => i + 1], ['客户名称', r => r.name], ['账期', r => r.period], ['应付日期', r => r.due || '-'],
          ['超期天数', r => r.days], ['超期未支付金额', r => r.amt], ['累计未支付金额', r => r.total]];
      } else {
        name = '仓库预警.xlsx'; rows = this.whAlerts;
        cols = [['序号', (r, i) => i + 1], ['仓库名称', r => r.name], ['仓库地址', r => r.address], ['负责人', r => r.manager],
          ['联系电话', r => r.phone], ['每月租金', r => r.rent], ['到期时间', r => r.expireDate], ['剩余天数', r => r.days], ['房东/联系电话', r => r.landlord || '-']];
      }
      U.exportExcel(name, rows.map((r, i) => {
        const o = {};
        cols.forEach(([label, fn]) => { o[label] = fn(r, i); });
        return o;
      }));
    },
    alertRows(key, all) {
      const src = key === 'stock' ? this.stockAlerts : key === 'pay' ? this.payAlerts : this.whAlerts;
      return all ? src : src.slice(0, 10);
    },
    /* ---------- 横向分析图 ---------- */
    renderChart() {
      const el = this.$refs.chart;
      if (!el) return;
      if (!this._chart) this._chart = echarts.init(el);
      const days = [];
      let d = this.hd1;
      const end = this.hd2;
      let guard = 0;
      while (d <= end && guard++ < 730) { days.push(d); d = U.addDays(d, 1); }
      const zero = () => days.map(() => 0);
      const idx = t => days.indexOf(U.ymd(t));
      let series = [];
      const db = S.db;
      if (this.metric === '销售数量') {
        const v = zero();
        S.completedSalesIn(this.hd1, this.hd2).forEach(s => {
          const i = idx(s.finishTime || s.createTime);
          if (i >= 0) v[i] += S.saleNetQty(s);
        });
        series = [{ name: '销售数量', data: v }];
      } else if (this.metric === '销售金额') {
        const v = zero();
        S.completedSalesIn(this.hd1, this.hd2).forEach(s => {
          const i = idx(s.finishTime || s.createTime);
          if (i >= 0) v[i] = U.round2(v[i] + S.saleNet(s));
        });
        series = [{ name: '销售金额（净额）', data: v }];
      } else if (this.metric === '收款金额') {
        const v = zero();
        db.sales.filter(s => s.payStatus === '已支付' && U.inRange(s.finishTime || s.createTime, this.hd1, this.hd2)).forEach(s => {
          const i = idx(s.finishTime || s.createTime);
          if (i >= 0) v[i] = U.round2(v[i] + (Number(s.actualPaid) || S.salePayable(s)));
        });
        series = [{ name: '收款金额', data: v }];
      } else if (this.metric === '欠款金额') {
        const v = zero();
        db.sales.filter(s => s.status === '已完成' && s.payStatus !== '已支付').forEach(s => {
          const i = idx(s.finishTime || s.createTime);
          if (i >= 0) {
            const unpaid = U.round2(S.salePayable(s) - (Number(s.actualPaid) || 0));
            for (let k = i; k < v.length; k++) v[k] = U.round2(v[k] + unpaid);
          }
        });
        series = [{ name: '欠款金额（累计未付）', data: v }];
      } else if (this.metric === '支出金额') {
        const v = zero();
        db.expenses.filter(x => x.status === '已计算' && U.inRange(x.createTime, this.hd1, this.hd2)).forEach(x => {
          const i = idx(x.createTime);
          if (i >= 0) v[i] = U.round2(v[i] + Number(x.amount));
        });
        series = [{ name: '支出金额', data: v }];
      } else if (this.metric === '新增客户数量') {
        const v = zero();
        db.customers.forEach(c => { const i = idx(c.createTime); if (i >= 0) v[i]++; });
        series = [{ name: '新增客户', data: v }];
      } else if (this.metric === '各类型客户数量' || this.metric === '各级别客户数量') {
        const coll = this.metric === '各类型客户数量' ? 'custTypes' : 'custLevels';
        const key = this.metric === '各类型客户数量' ? 'typeId' : 'levelId';
        series = db[coll].map(t => {
          const v = zero();
          db.customers.filter(c => c[key] === t.id).forEach(c => { const i = idx(c.createTime); if (i >= 0) v[i]++; });
          return { name: t.name, data: v };
        });
      } else if (this.metric === '资源合伙人数量') {
        series = [1, 2, 3].map(L => {
          const v = days.map(day => {
            const set = new Set();
            db.customers.filter(c => U.ymd(c.createTime) <= day && c['r' + L]).forEach(c => set.add(c['r' + L]));
            return set.size;
          });
          return { name: ['一级', '二级', '三级'][L - 1], data: v };
        });
      } else if (this.metric === '区域合伙人数量') {
        const v = days.map(day => {
          const set = new Set();
          db.customers.filter(c => U.ymd(c.createTime) <= day && c.regionPartnerId).forEach(c => set.add(c.regionPartnerId));
          return set.size;
        });
        series = [{ name: '区域合伙人', data: v }];
      }
      const last = days.length - 1;
      const cumulative = ['资源合伙人数量', '区域合伙人数量'].includes(this.metric);
      this.metricTotal = U.round2(series.reduce((a, s) => a + (cumulative ? (s.data[last] || 0) : s.data.reduce((x, y) => x + y, 0)), 0));
      this._chart.setOption({
        backgroundColor: '#fff',
        tooltip: { trigger: 'axis' },
        legend: { top: 0, textStyle: { color: '#334155' } },
        grid: { left: 45, right: 20, top: 34, bottom: 28 },
        xAxis: { type: 'category', data: days, axisLabel: { color: '#64748b' } },
        yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#64748b' } },
        color: ['#1d4ed8', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2'],
        series: series.map(s => ({ ...s, type: 'line', smooth: true, symbolSize: 5 }))
      }, true);
    }
  },
  watch: {
    hd1() { this.renderChart(); }, hd2() { this.renderChart(); }, metric() { this.renderChart(); }
  },
  mounted() {
    this.renderChart();
    this._onResize = () => this._chart && this._chart.resize();
    window.addEventListener('resize', this._onResize);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this._onResize);
    if (this._chart) { this._chart.dispose(); this._chart = null; }
  },
  template: `
  <div>
    <div class="page-title">仪表盘</div>

    <!-- 全局统计 -->
    <div class="stat-grid">
      <div class="stat-card clickable" @click="go('goods')"><div class="t">商品总数</div><div class="v">{{stats.goodsTotal}}</div><div class="sub">{{subText(stats.goodsByType,' 种')}}</div></div>
      <div class="stat-card clickable" @click="go('goods')"><div class="t">供应商总数</div><div class="v">{{stats.supplierTotal}}</div><div class="sub">点击进入商品管理 - 供应商管理</div></div>
      <div class="stat-card clickable" @click="go('warehouse')"><div class="t">仓库数量</div><div class="v">{{stats.whTotal}}</div>
        <div class="sub">每月租金合计 ￥{{fmtMoney(stats.rentSum)}}</div></div>
      <div class="stat-card clickable" @click="go('customers')"><div class="t">客户总数</div><div class="v">{{stats.custTotal}}</div>
        <div class="sub">类型：{{subText(stats.custByType)}}<br>级别：{{subText(stats.custByLevel)}}<br>区域：{{subText(stats.custByRegion)}}</div></div>
      <div class="stat-card clickable" @click="go('partners')"><div class="t">合伙人</div><div class="v">{{stats.rp.total}} <span style="font-size:12px;color:#64748b">资源</span> + {{stats.regionPartnerTotal}} <span style="font-size:12px;color:#64748b">区域</span></div>
        <div class="sub">资源：一级 {{stats.rp.l1}} ｜ 二级 {{stats.rp.l2}} ｜ 三级 {{stats.rp.l3}}（去重共 {{stats.rp.total}} 人）</div></div>
      <div class="stat-card c2 clickable" @click="go('inventory')"><div class="t">库存总数</div><div class="v">{{fmtNum(stats.invQty)}}</div><div class="sub">{{subText(stats.invByType,' 件')}}</div></div>
      <div class="stat-card c2 clickable" @click="go('inventory')"><div class="t">库存成本 / 预计销售额</div><div class="v money">￥{{fmtMoney(stats.invCost)}}</div>
        <div class="sub">预计销售额 ￥{{fmtMoney(stats.invValue)}} ｜ 预计毛利 <b class="green-t">￥{{fmtMoney(stats.invProfit)}}</b></div></div>
      <div class="stat-card c2 clickable" @click="go('sales')"><div class="t">累计销售额（净额）</div><div class="v money">￥{{fmtMoney(stats.totalSales)}}</div>
        <div class="sub">已完成销售单扣除退货后的净额</div></div>
      <div class="stat-card c3 clickable" @click="go('finance')"><div class="t">累计成本</div><div class="v money">￥{{fmtMoney(stats.totalCost)}}</div>
        <div class="sub">日常运营 ￥{{fmtMoney(stats.opCost)}} ｜ 税点成本 ￥{{fmtMoney(stats.taxCost)}} ｜ 配送费成本 ￥{{fmtMoney(stats.deliveryCost)}}<br>资源佣金 ￥{{fmtMoney(stats.resComm)}} ｜ 区域佣金 ￥{{fmtMoney(stats.regComm)}}</div></div>
      <div class="stat-card c3 clickable" @click="go('commission')"><div class="t">累计佣金</div><div class="v money">￥{{fmtMoney(stats.resComm + stats.regComm)}}</div>
        <div class="sub">资源 ￥{{fmtMoney(stats.resComm)}} ｜ 区域 ￥{{fmtMoney(stats.regComm)}}</div></div>
      <div class="stat-card c2 clickable" @click="go('purchase')"><div class="t">累计采购金额</div><div class="v money">￥{{fmtMoney(stats.totalPurchase)}}</div>
        <div class="sub">采购入库总成本（含税）</div></div>
      <div class="stat-card c2 clickable" @click="go('sales')"><div class="t">累计收款（已支付）</div><div class="v money">￥{{fmtMoney(stats.totalReceipts)}}</div>
        <div class="sub">分类型收款：{{subText(stats.receiptByMethod,' 元')}}</div></div>
      <div class="stat-card c2 clickable" @click="go('sales')"><div class="t">累计欠款金额</div><div class="v money red">￥{{fmtMoney(stats.totalArrears)}}</div>
        <div class="sub">全部客户累计未支付金额</div></div>
      <div class="stat-card c2 clickable" @click="go('finance')"><div class="t">累计支出金额</div><div class="v money">￥{{fmtMoney(stats.totalExpense)}}</div>
        <div class="sub">已计算日常运营支出合计</div></div>
      <div class="stat-card c2 clickable" @click="go('capital')"><div class="t">注资总额</div><div class="v money">￥{{fmtMoney(stats.totalCapital)}}</div>
        <div class="sub">股东累计注入资金</div></div>
      <div class="stat-card c4 clickable" @click="go('complaint')"><div class="t">累计投诉</div><div class="v">{{stats.cmpTotal}}</div><div class="sub">{{subText(stats.cmpByType,' 件')}}</div></div>
      <div class="stat-card c4 clickable" @click="go('inventory')"><div class="t">库存预警</div><div class="v">{{stockAlerts.length}} <span style="font-size:12px;color:#64748b">项</span></div><div class="sub">低于最低库存的商品数</div></div>
      <div class="stat-card c4 clickable" @click="go('sales')"><div class="t">超期未支付客户</div><div class="v">{{payAlerts.length}} <span style="font-size:12px;color:#64748b">家</span></div><div class="sub">存在超期欠款的客户数</div></div>
    </div>

    <!-- 横向分析 -->
    <div class="card">
      <h3>横向分析（趋势）
        <span style="display:flex;gap:8px;align-items:center;font-weight:400;flex-wrap:wrap">
          <x-combobox v-model="metric" :options="metricOpts" placeholder="选择指标" style="width:150px"/>
          <input type="date" v-model="hd1"> - <input type="date" v-model="hd2">
          <button class="btn btn-sm" @click="range('h','week')">本周</button>
          <button class="btn btn-sm" @click="range('h','month')">本月</button>
        </span>
      </h3>
      <div ref="chart" class="chart-box"></div>
      <div class="sub" style="margin-top:8px">本区间合计：<b class="money" :class="{red:metricIsMoney}">{{ metricIsMoney ? '￥'+fmtMoney(metricTotal) : metricTotal }}</b></div>
    </div>

    <!-- 纵向分析 -->
    <div class="card">
      <h3>纵向分析（排名 TOP10）
        <span style="display:flex;gap:8px;align-items:center;font-weight:400;flex-wrap:wrap">
          <x-combobox v-model="rank" :options="rankOpts" placeholder="选择排名" style="width:210px"/>
          <input type="date" v-model="vd1"> - <input type="date" v-model="vd2">
          <button class="btn btn-sm" @click="range('v','week')">本周</button>
          <button class="btn btn-sm" @click="range('v','month')">本月</button>
          <button class="btn btn-sm" @click="showMore=true">更多（全部排名）</button>
          <button class="btn btn-sm" @click="exportRank">导出</button>
        </span>
      </h3>
      <table class="grid">
        <thead><tr><th style="width:60px">排名</th><th v-for="c in ranking.cols" :class="{num:c.num}">{{c.label}}</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in top10" :key="r.name">
            <td><span class="tag" :class="i<3?'tag-red':'tag-gray'">{{i+1}}</span></td>
            <td v-for="c in ranking.cols" :class="{num:c.num, money:c.money}">{{c.money ? fmtMoney(r[c.k]) : r[c.k]}}</td>
          </tr>
          <tr v-if="!top10.length"><td :colspan="ranking.cols.length+1" class="empty">该时间范围内暂无数据</td></tr>
          <tr class="total-row" v-if="ranking.rows.length">
            <td>合计</td>
            <td v-for="c in ranking.cols" :class="{num:c.num, money:c.money}">
              <template v-if="c.k==='qty'">{{rankTotal.qty}}</template>
              <template v-else-if="c.k==='amt'">{{fmtMoney(rankTotal.amt)}}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 预警事项 -->
    <div class="card">
      <h3>预警事项</h3>
      <div style="display:grid;grid-template-columns:1fr;gap:16px">
        <div>
          <div class="section-title">库存预警 <span class="muted">（按缺口从大到小）</span>
            <span style="float:right;font-weight:400">
              <button class="btn btn-sm" @click="expanded.stock=!expanded.stock">{{expanded.stock?'收起':'更多'}}</button>
              <button class="btn btn-sm" @click="exportAlert('stock')">导出</button>
            </span>
          </div>
          <table class="grid">
            <thead><tr><th>序号</th><th>商品名称</th><th class="num">库存数量</th><th class="num">最低库存</th><th class="num">缺口</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in alertRows('stock',expanded.stock)"><td>{{i+1}}</td><td>{{r.name}}</td>
                <td class="num red"><b>{{r.qty}}</b></td><td class="num">{{r.min}}</td><td class="num red">{{r.min-r.qty}}</td></tr>
              <tr v-if="!stockAlerts.length"><td colspan="5" class="empty">暂无库存预警</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <div class="section-title">超期未支付预警 <span class="muted">（按超期欠款从大到小）</span>
            <span style="float:right;font-weight:400">
              <button class="btn btn-sm" @click="expanded.pay=!expanded.pay">{{expanded.pay?'收起':'更多'}}</button>
              <button class="btn btn-sm" @click="exportAlert('pay')">导出</button>
            </span>
          </div>
          <table class="grid">
            <thead><tr><th>序号</th><th>客户名称</th><th>账期</th><th>应付日期</th><th class="num">超期天数</th><th class="num">超期未支付金额</th><th class="num">累计未支付金额</th></tr></thead>
            <tbody>
              <tr v-for="(r,i) in alertRows('pay',expanded.pay)"><td>{{i+1}}</td><td>{{r.name}}</td>
                <td>{{r.period}}</td><td>{{r.due||'-'}}</td>
                <td class="num"><span class="tag" :class="r.days>30?'tag-red':'tag-orange'">{{r.days}} 天</span></td>
                <td class="num money red"><b>{{fmtMoney(r.amt)}}</b></td><td class="num money">{{fmtMoney(r.total)}}</td></tr>
              <tr v-if="!payAlerts.length"><td colspan="7" class="empty">暂无超期未支付预警</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="section-title">仓库预警 <span class="muted">（按到期时间从近到远）</span>
          <span style="float:right;font-weight:400">
            <button class="btn btn-sm" @click="expanded.wh=!expanded.wh">{{expanded.wh?'收起':'更多'}}</button>
            <button class="btn btn-sm" @click="exportAlert('wh')">导出</button>
          </span>
        </div>
        <table class="grid">
          <thead><tr><th>序号</th><th>仓库名称</th><th>仓库地址</th><th>负责人</th><th>联系电话</th><th class="num">每月租金</th><th>到期时间</th><th>剩余天数</th><th>房东/联系电话</th></tr></thead>
          <tbody>
            <tr v-for="(w,i) in alertRows('wh',expanded.wh)"><td>{{i+1}}</td><td>{{w.name}}</td><td>{{w.address}}</td><td>{{w.manager}}</td><td>{{w.phone}}</td>
              <td class="num money">{{fmtMoney(w.rent)}}</td><td>{{w.expireDate}}</td>
              <td><span class="tag" :class="w.days<=30?'tag-red':(w.days<=60?'tag-orange':'tag-green')">{{w.days<0?'已到期':w.days+' 天'}}</span></td>
              <td>{{w.landlord||'-'}}</td></tr>
            <tr v-if="!whAlerts.length"><td colspan="9" class="empty">暂无仓库信息</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 更多排名弹窗 -->
    <x-modal v-if="showMore" :title="rank+'（全部）'" :width="640" @close="showMore=false">
      <table class="grid">
        <thead><tr><th style="width:60px">排名</th><th v-for="c in ranking.cols" :class="{num:c.num}">{{c.label}}</th></tr></thead>
        <tbody>
          <tr v-for="(r,i) in ranking.rows" :key="r.name">
            <td>{{i+1}}</td>
            <td v-for="c in ranking.cols" :class="{num:c.num, money:c.money}">{{c.money ? fmtMoney(r[c.k]) : r[c.k]}}</td>
          </tr>
          <tr class="total-row">
            <td>合计</td>
            <td v-for="c in ranking.cols" :class="{num:c.num, money:c.money}">
              <template v-if="c.k==='qty'">{{rankTotal.qty}}</template>
              <template v-else-if="c.k==='amt'">{{fmtMoney(rankTotal.amt)}}</template>
              <template v-else>—</template>
            </td>
          </tr>
        </tbody>
      </table>
      <template #foot>
        <button class="btn" @click="exportRank">导出 Excel</button>
        <button class="btn" @click="showMore=false">关闭</button>
      </template>
    </x-modal>
  </div>`
};
