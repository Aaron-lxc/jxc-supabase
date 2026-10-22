/* 库存流水：聚合采购/销售/退货/调拨/生产/报损/报溢/期初等 collection，
   还原每批货的逐笔变动时间线（只读聚合，不写入任何数据，无数据风险）。
   来源（type）与正负号：+ 入库，− 出库。 */
window.Pages = window.Pages || {};

Pages['page-invflow'] = {
  data() {
    return {
      q: { whId: '', goodsId: '', type: '', batch: '', doc: '', t1: '', t2: '' },
      page: 1, pageSize: 10
    };
  },
  watch: {
    q: { deep: true, handler() { this.page = 1; } }
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
        // 批次号/单据号模糊查询（不区分大小写的包含匹配；未分批次行按显示值参与匹配）
        const bn = (batchNo === null || batchNo === undefined || batchNo === '__NONE__') ? '未分批次' : batchNo;
        if (this.q.batch && bn.toLowerCase().indexOf(this.q.batch.trim().toLowerCase()) < 0) return;
        if (this.q.doc && String(docNo || '').toLowerCase().indexOf(this.q.doc.trim().toLowerCase()) < 0) return;
        out.push({
          time, whName: S.name('warehouses', whId), goodsName: gName(goodsId),
          batchNo: bn,
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
    total() { return this.all.length; },
    totals() {
      let inQty = 0, outQty = 0;
      this.all.forEach(r => { if (r.qty > 0) inQty += r.qty; else outQty += Math.abs(r.qty); });
      return { inQty: U.round2(inQty), outQty: U.round2(outQty) };
    }
  },
  methods: {
    fmtNum: U.fmtNum,
    /* 与 store.transferItems 同源：单条 goodsId 退化为单明细数组 */
    transferItems(t) {
      if (Array.isArray(t.items) && t.items.length) return t.items;
      if (t.goodsId != null) return [{ goodsId: t.goodsId, batchNo: t.batchNo == null ? null : t.batchNo, qty: t.qty }];
      return [];
    },
    /* 类型标签颜色：期初=蓝，入库=绿，出库=红（与系统 tag 体系一致） */
    typeTag(r) {
      if (r.type === 'opening') return 'tag-blue';
      return r.qty > 0 ? 'tag-green' : 'tag-red';
    },
    goGoods(g) { if (g) this.q.goodsId = g; },
    exportExcel() {
      U.exportExcel('库存流水.xlsx', this.all.map((r, i) => ({
        '序号': i + 1, '时间': r.time, '仓库': r.whName, '商品名称': r.goodsName,
        '批次号': r.batchNo, '类型': r.typeLabel, '数量': (r.qty > 0 ? '+' : '') + r.qty, '单据号': r.docNo
      })));
    }
  },
  template: `
  <div>
    <div class="page-title">库存流水</div>
    <div class="card">
      <div class="toolbar">
        <x-combobox v-model="q.whId" :options="whOpts" style="width:140px"/>
        <x-combobox v-model="q.goodsId" :options="goodsOpts" style="width:220px"/>
        <x-combobox v-model="q.type" :options="typeOpts" style="width:140px"/>
        <input type="text" v-model="q.batch" placeholder="批次号模糊查询" style="width:150px">
        <input type="text" v-model="q.doc" placeholder="单据号模糊查询" style="width:150px">
        <span class="muted">流水时间</span><input type="date" v-model="q.t1"> - <input type="date" v-model="q.t2">
        <div class="spacer"></div>
        <span class="muted">共 {{fmtNum(total)}} 笔 ｜ 入库 {{fmtNum(totals.inQty)}} 件 ｜ 出库 {{fmtNum(totals.outQty)}} 件（只读，不修改数据）</span>
        <button class="btn" @click="exportExcel">导出</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>时间</th><th>仓库</th><th>商品名称</th><th>批次号</th><th>类型</th><th class="num">数量</th><th>单据号</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged" :key="i">
            <td data-label="序号">{{(page-1)*pageSize+i+1}}</td>
            <td data-label="时间">{{r.time}}</td>
            <td data-label="仓库">{{r.whName}}</td>
            <td data-label="商品名称">{{r.goodsName}}</td>
            <td data-label="批次号">{{r.batchNo}}</td>
            <td data-label="类型"><span class="tag" :class="typeTag(r)">{{r.typeLabel}}</span></td>
            <td class="num" :class="{red: r.qty<0, 'green-t': r.qty>0}" data-label="数量"><b>{{r.qty>0?'+':''}}{{r.qty}}</b></td>
            <td data-label="单据号">{{r.docNo}}</td>
          </tr>
          <tr v-if="!paged.length"><td colspan="8" class="empty">暂无流水记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="total" v-model:page="page" v-model:size="pageSize"/>
    </div>
  </div>`
};
