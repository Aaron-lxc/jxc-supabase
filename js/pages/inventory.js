/* 库存管理 + 批量盘库 */
window.Pages = window.Pages || {};

Pages['page-inventory'] = {
  data() {
    return {
      q: { whId: '', typeId: '', name: '', supplierId: '', lastInT1: '', lastInT2: '' },
      page: 1, pageSize: 10, showCheck: false, checkRows: []
    };
  },
  computed: {
    S() { return window.S; },
    whOpts() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    typeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    supplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    rows() {
      return S.db.stocks.map(s => {
        const g = S.byId('goods', s.goodsId) || {};
        return {
          id: s.id, rec: s, whId: s.whId, goodsId: s.goodsId,
          whName: S.name('warehouses', s.whId), goodsName: g.name || '',
          typeId: g.typeId, typeName: S.name('goodsTypes', g.typeId),
          sku: g.sku || '', unitName: S.name('units', g.unitId),
          supplierId: g.supplierId, supplierName: S.name('suppliers', g.supplierId),
          qty: s.qty, minStock: g.minStock || 0,
          cost: U.round2(s.qty * (g.purchasePrice || 0)),
          value: U.round2(s.qty * (g.retailPrice || 0)),
          lastInTime: s.lastInTime || '-', lastCheckTime: s.lastCheckTime || '-'
        };
      }).filter(r =>
        (!this.q.whId || r.whId === this.q.whId) &&
        (!this.q.typeId || r.typeId === this.q.typeId) &&
        U.kw(r.goodsName, this.q.name) &&
        (!this.q.supplierId || r.supplierId === this.q.supplierId) &&
        U.inRange(r.lastInTime, this.q.lastInT1, this.q.lastInT2)
      ).sort((a, b) => a.whName.localeCompare(b.whName) || a.goodsName.localeCompare(b.goodsName));
    },
    paged() { return this.rows.slice((this.page - 1) * this.pageSize, this.page * this.pageSize); },
    totals() {
      return {
        qty: this.rows.reduce((a, r) => a + r.qty, 0),
        cost: U.round2(this.rows.reduce((a, r) => a + r.cost, 0)),
        value: U.round2(this.rows.reduce((a, r) => a + r.value, 0))
      };
    }
  },
  methods: {
    fmtMoney: U.fmtMoney, fmtNum: U.fmtNum,
    rowFields(r) {
      return [
        { label: '仓库名称', value: r.whName },
        { label: '商品名称', value: r.goodsName },
        { label: '商品类型', value: r.typeName },
        { label: 'SKU', value: r.sku || '-' },
        { label: '单位', value: r.unitName },
        { label: '供应商', value: r.supplierName },
        { label: '当前库存', value: r.qty },
        { label: '最低库存', value: r.minStock },
        { label: '库存成本', value: U.fmtMoney(r.cost) },
        { label: '库存价值', value: U.fmtMoney(r.value) },
        { label: '最后入库时间', value: r.lastInTime },
        { label: '最近盘库时间', value: r.lastCheckTime }
      ];
    },
    openCheck() {
      if (!this.rows.length) return alert('当前筛选条件下没有库存记录');
      this.checkRows = this.rows.map(r => ({
        rec: r.rec, whName: r.whName, goodsName: r.goodsName, sku: r.sku,
        unitName: r.unitName, qty: r.qty, actual: r.qty
      }));
      this.showCheck = true;
    },
    submitCheck() {
      let changed = 0;
      const t = U.now();
      this.checkRows.forEach(cr => {
        const actual = Number(cr.actual);
        if (isNaN(actual) || actual < 0) return;
        if (actual !== cr.rec.qty) {
          S.db.stockChecks.push({
            id: S.genId(), whId: cr.rec.whId, goodsId: cr.rec.goodsId,
            before: cr.rec.qty, after: actual, diff: actual - cr.rec.qty, time: t
          });
          cr.rec.qty = actual;
          changed++;
        }
        cr.rec.lastCheckTime = t;
      });
      this.showCheck = false;
      alert('盘库完成：共盘点 ' + this.checkRows.length + ' 条记录，其中 ' + changed + ' 条有差异并已修正库存');
    },
    exportData() {
      U.exportExcel('库存明细.xlsx', this.rows.map((r, i) => ({
        '序号': i + 1, '仓库名称': r.whName, '商品名称': r.goodsName, '商品类型': r.typeName,
        'SKU': r.sku, '商品单位': r.unitName, '供应商': r.supplierName,
        '当前库存': r.qty, '最低库存': r.minStock, '库存成本': r.cost, '库存价值': r.value,
        '最后一次入库时间': r.lastInTime, '最近一次盘库时间': r.lastCheckTime
      })));
    }
  },
  template: `
  <div>
    <div class="page-title">库存管理</div>
    <div class="card">
      <div class="toolbar">
        <x-combobox v-model="q.whId" :options="whOpts" style="width:140px"/>
        <x-combobox v-model="q.typeId" :options="typeOpts" style="width:140px"/>
        <input type="text" v-model="q.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="q.supplierId" :options="supplierOpts" style="width:150px"/>
        <span class="muted">最后入库</span><input type="date" v-model="q.lastInT1"> - <input type="date" v-model="q.lastInT2">
        <div class="spacer"></div>
        <span class="muted">合计：{{fmtNum(totals.qty)}} 件 / 成本 ￥{{fmtMoney(totals.cost)}} / 价值 ￥{{fmtMoney(totals.value)}}</span>
        <button class="btn" @click="exportData">导出</button>
        <button class="btn btn-primary" @click="openCheck">批量盘库</button>
      </div>
      <div class="table-wrap">
      <template v-if="!$root.isMobile">
      <table class="grid wide-table">
        <thead><tr>
          <th>序号</th><th>仓库名称</th><th>商品名称</th><th>商品类型</th><th>SKU</th><th>单位</th><th>供应商</th>
          <th class="num">当前库存</th><th class="num">最低库存</th><th class="num">库存成本</th><th class="num">库存价值</th>
          <th>最后入库时间</th><th>最近盘库时间</th>
        </tr></thead>
        <tbody>
          <tr v-for="(r,i) in paged" :key="r.id">
            <td>{{(page-1)*pageSize+i+1}}</td><td>{{r.whName}}</td><td>{{r.goodsName}}</td><td>{{r.typeName}}</td>
            <td>{{r.sku}}</td><td>{{r.unitName}}</td><td>{{r.supplierName}}</td>
            <td class="num" :class="{red: r.qty < r.minStock}"><b>{{r.qty}}</b>
              <span v-if="r.qty < r.minStock" class="tag tag-red">低于下限</span></td>
            <td class="num">{{r.minStock}}</td>
            <td class="num money">{{fmtMoney(r.cost)}}</td><td class="num money">{{fmtMoney(r.value)}}</td>
            <td>{{r.lastInTime}}</td><td>{{r.lastCheckTime}}</td>
          </tr>
          <tr v-if="!paged.length"><td colspan="13" class="empty">暂无库存记录（采购入库后自动生成）</td></tr>
        </tbody>
      </table>
      </template>
      <div v-else class="row-cards">
        <div v-for="r in paged" :key="r.id" class="row-card" @click="$root.openRow(r, rowFields(r), '库存详情')">
          <div class="rc-title">{{r.goodsName}}</div>
          <div class="rc-sub">{{r.whName}}</div>
          <div class="rc-row"><span>当前库存</span><b :class="{red: r.qty < r.minStock}">{{r.qty}}</b></div>
          <div class="rc-row"><span>库存价值</span><b class="money">{{fmtMoney(r.value)}}</b></div>
        </div>
        <div v-if="!paged.length" class="empty">暂无数据</div>
      </div>
      </div>
      <x-pager :total="rows.length" v-model:page="page" v-model:size="pageSize"/>
    </div>

    <x-modal v-if="showCheck" title="批量盘库（修改实际库存后提交，差异自动留痕）" :width="720" :fullscreen="$root.isMobile" @close="showCheck=false">
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr><th>仓库</th><th>商品</th><th>SKU</th><th>单位</th><th class="num">账面库存</th><th class="num" style="width:110px">实际库存</th><th class="num">差异</th></tr></thead>
        <tbody>
          <tr v-for="cr in checkRows">
            <td>{{cr.whName}}</td><td>{{cr.goodsName}}</td><td>{{cr.sku}}</td><td>{{cr.unitName}}</td>
            <td class="num">{{cr.qty}}</td>
            <td class="num"><input type="number" min="0" style="width:90px" v-model.number="cr.actual"></td>
            <td class="num" :class="{red: cr.actual-cr.qty<0, 'green-t': cr.actual-cr.qty>0}">{{(cr.actual||0)-cr.qty}}</td>
          </tr>
        </tbody>
      </table>
      </div>
      <template #foot>
        <button class="btn" @click="showCheck=false">取消</button>
        <button class="btn btn-primary" @click="submitCheck">提交盘库结果</button>
      </template>
    </x-modal>
  </div>`
};
