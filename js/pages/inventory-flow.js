/* 库存流水：聚合采购/销售/退货/调拨/生产/报损/报溢/期初等 collection，
   还原每批货的逐笔变动时间线（只读聚合，不写入任何数据，无数据风险）。
   来源（type）与正负号：+ 入库，− 出库。 */
window.Pages = window.Pages || {};

Pages['page-invflow'] = {
  data() {
    return {
      q: { whId: '', goodsId: '', type: '', t1: '', t2: '' },
      page: 1, pageSize: 15
    };
  },
  computed: {
    S() { return window.S; },
    canView() { return P.canView('invflow'); },
    whOpts() { return [{ value: '', label: '全部仓库' }].concat((S.db.warehouses || []).map(w => ({ value: w.id, label: w.name }))); },
    goodsOpts() { return [{ value: '', label: '全部商品' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name }))); },
    typeOpts() {
      return [
        { value: '', label: '全部类型' },
        { value: 'purchase', label: '采购入库' },
        { value: 'sale', label: '销售出库' },
        { value: 'return', label: '退货入库' },
        { value: 'transferOut', label: '调拨出库' },
        { value: 'transferIn', label: '调拨入库' },
        { value: 'prodOut', label: '生产耗料' },
        { value: 'prodIn', label: '生产完工' },
        { value: 'loss', label: '报损出库' },
        { value: 'overflow', label: '报溢入库' },
        { value: 'opening', label: '期初入库' }
      ];
    },
    /* 聚合所有 collection 为逐笔流水（按时间倒序） */
    all() {
      const S = this.S, db = S.db || {};
      const out = [];
      const gName = id => (S.byId('goods', id) || {}).name || '';
      const push = (time, whId, goodsId, batchNo, type, qty, docNo) => {
        if (whId && this.q.whId && whId !== this.q.whId) return;
        if (this.q.goodsId && goodsId !== this.q.goodsId) return;
        if (this.q.type && type !== this.q.type) return;
        if (!U.inRange(time, this.q.t1, this.q.t2)) return;
        out.push({
          time, whName: S.name('warehouses', whId), goodsName: gName(goodsId),
          batchNo: (batchNo === null || batchNo === undefined || batchNo === '__NONE__') ? '未分批次' : batchNo,
          type, typeLabel: (this.typeOpts.find(t => t.value === type) || {}).label || type,
          qty, docNo: docNo || ''
        });
      };
      // 采购入库
      (db.purchases || []).forEach(p => (p.items || []).forEach(it =>
        push(p.inTime || p.createTime, p.whId, it.goodsId, it.batchNo || p.no, 'purchase', Number(it.qty), p.no)));
      // 销售出库
      (db.sales || []).forEach(s => (s.items || []).forEach(it =>
        push(s.saleTime || s.finishTime || s.createTime, s.whId, it.goodsId, (it.alloc && it.alloc[0] && it.alloc[0].batchNo) || '未分批次', 'sale', -Number(it.qty), s.no)));
      // 退货入库
      (db.returns || []).forEach(r => (r.items || []).forEach(it =>
        push(r.createTime, r.whId, it.goodsId, '未分批次', 'return', Number(it.qty), r.no)));
      // 调拨：出库（发货仓）+ 入库（收货仓）
      (db.transfers || []).forEach(t => (t.status === '已生效') && (this.transferItems(t)).forEach(it => {
        push(t.time || t.createTime, t.fromWhId, it.goodsId, it.batchNo, 'transferOut', -Number(it.qty), t.no);
        push(t.time || t.createTime, t.toWhId, it.goodsId, it.batchNo, 'transferIn', Number(it.qty), t.no);
      }));
      // 生产：耗料（各原材料出库）+ 完工（成品入库）
      (db.productions || []).forEach(p => {
        if (p.status !== '已完成') return;
        (p.items || []).forEach(it => push(p.time || p.createTime, it.whId, it.goodsId, it.batchNo, 'prodOut', -Number(it.qty), p.no));
        if (p.producedGoodsId) push(p.time || p.createTime, p.whId, p.producedGoodsId, p.batchNo, 'prodIn', Number(p.qty), p.no);
      });
      // 报损出库
      (db.losses || []).forEach(l => push(l.time, l.whId, l.goodsId, l.batchNo || '未分批次', 'loss', -Number(l.qty), l.no));
      // 报溢入库
      (db.overflows || []).forEach(o => push(o.time, o.whId, o.goodsId, o.batchNo || '未分批次', 'overflow', Number(o.qty), o.no));
      // 期初入库
      (db.openingStocks || []).forEach(o => push(S.db.settings && S.db.settings.openingTimes && S.db.settings.openingTimes.stock || o.createTime, o.whId, o.goodsId, o.batchNo, 'opening', Number(o.qty), '期初'));
      return out.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    paged() { return this.all.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    total() { return this.all.length; }
  },
  methods: {
    /* 与 store.transferItems 同源：单条 goodsId 退化为单明细数组 */
    transferItems(t) {
      if (Array.isArray(t.items) && t.items.length) return t.items;
      if (t.goodsId != null) return [{ goodsId: t.goodsId, batchNo: t.batchNo == null ? null : t.batchNo, qty: t.qty }];
      return [];
    },
    goGoods(g) { if (g) this.q.goodsId = g; },
    exportCsv() {
      const head = ['时间', '仓库', '商品', '批次', '类型', '数量', '单据号'];
      const rows = this.all.map(r => [r.time, r.whName, r.goodsName, r.batchNo, r.typeLabel, (r.qty > 0 ? '+' : '') + r.qty, r.docNo]);
      const esc = v => { v = (v == null ? '' : String(v)); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      const csv = '﻿' + [head].concat(rows).map(line => line.map(esc).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '库存流水.csv';
      a.click();
      if (URL.revokeObjectURL) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  },
  template: `
  <div class="page">
    <div class="page-head">
      <h2>库存流水</h2>
      <p class="muted">聚合采购 / 销售 / 退货 / 调拨 / 生产 / 报损 / 报溢 / 期初的逐笔变动，便于追溯每批货的来路。<b>本页只读，不修改任何数据。</b></p>
    </div>
    <div class="filters">
      <x-combobox v-model="q.whId" :options="whOpts" style="width:160px" placeholder="仓库"/>
      <x-combobox v-model="q.goodsId" :options="goodsOpts" style="width:220px" placeholder="商品"/>
      <x-combobox v-model="q.type" :options="typeOpts" style="width:160px" placeholder="类型"/>
      <input type="date" v-model="q.t1" class="input"/>
      <span class="muted">至</span>
      <input type="date" v-model="q.t2" class="input"/>
      <button class="btn" @click="page=1;exportCsv()">导出 CSV</button>
    </div>
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>
          <th>时间</th><th>仓库</th><th>商品</th><th>批次</th><th>类型</th><th class="num">数量</th><th>单据号</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged" :key="i">
            <td>{{r.time}}</td>
            <td>{{r.whName}}</td>
            <td>{{r.goodsName}}</td>
            <td>{{r.batchNo}}</td>
            <td>{{r.typeLabel}}</td>
            <td class="num" :class="{red: r.qty<0, green: r.qty>0}">{{r.qty>0?'+':''}}{{r.qty}}</td>
            <td>{{r.docNo}}</td>
          </tr>
          <tr v-if="!paged.length"><td colspan="7" class="empty">暂无流水记录</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pager" v-if="total>pageSize">
      <button class="btn" :disabled="page<=1" @click="page--">上一页</button>
      <span class="muted">第 {{page}} / {{Math.ceil(total/pageSize)}} 页 · 共 {{total}} 条</span>
      <button class="btn" :disabled="page>=Math.ceil(total/pageSize)" @click="page++">下一页</button>
    </div>
  </div>`
};
