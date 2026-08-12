/* 生产组装（独立菜单：介于采购管理与库存管理之间）
   业务闭环：以现有库存商品为原材料，加工组装成新商品，自动核算成本并入库；
             未完成=草稿（不改库存），完成后消耗原材料库存、生成新商品(同步商品管理)、按批次入库新商品。
   数据闭环：数据走 S.db.productions（jsonb records），store 方法 addProduction/updateProduction/
            completeProduction/deleteProduction/genScBatch 完全复用，无需改同步层。
   批次号格式：SC-年月日-00001（顺序号）；商品单位下拉 unitOpts 此前在库存页缺失，此处补全。 */
window.Pages = window.Pages || {};

/* 生产单成品字段与商品管理字段的同步映射（下拉选商品时带入表单；手改字段完工回写商品管理） */
const PROD_SYNC_FIELDS = ['typeId', 'unitId', 'supplierId', 'sku', 'retailPrice', 'bigPrice', 'wholesalePrice', 'shelfLife', 'expireWarn'];

Pages['page-production'] = {
  data() {
    return {
      prodQ: { name: '', typeId: '', whId: '', t1: '', t2: '' },
      prodPage: 1, prodSize: 10, showProdForm: false, editingProd: null, prodForm: {}, prodBase: {}
    };
  },
  computed: {
    S() { return window.S; },
    /* 独立权限模块 production（默认 edit），不依赖库存管理权限 */
    canProd() { return P.canView('production'); },
    canProdEdit() { return P.canEdit('production'); },
    selfSupplierId() { const s = S.db.suppliers.find(x => x.name === '自营'); return s ? s.id : ''; },
    whPickOpts() { return S.db.warehouses.map(w => ({ value: w.id, label: w.name })); },
    whOpts() { return [{ value: '', label: '全部仓库' }].concat(S.db.warehouses.map(w => ({ value: w.id, label: w.name }))); },
    typeOpts() { return [{ value: '', label: '全部商品类型' }].concat(S.db.goodsTypes.map(t => ({ value: t.id, label: t.name }))); },
    supplierOpts() { return [{ value: '', label: '全部供应商' }].concat(S.db.suppliers.map(s => ({ value: s.id, label: s.name }))); },
    unitOpts() { return [{ value: '', label: '请选择单位' }].concat(S.db.units.map(u => ({ value: u.id, label: u.name }))); },

    /* ---------- 生产组装 ---------- */
    prodRows() {
      return S.db.productions.filter(p =>
        U.kw(p.goodsName || '', this.prodQ.name) &&
        (!this.prodQ.typeId || p.typeId === this.prodQ.typeId) &&
        (!this.prodQ.whId || p.whId === this.prodQ.whId) &&
        U.inRange(p.time, this.prodQ.t1, this.prodQ.t2)
      ).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
    },
    prodPaged() { return this.prodRows.slice((this.prodPage - 1) * this.prodSize, this.prodPage * this.prodSize); },
    prodQtySum() { return U.round2(this.prodRows.reduce((a, p) => a + Number(p.qty || 0), 0)); },
    prodAmountSum() { return U.round2(this.prodRows.reduce((a, p) => a + Number(p.amount || 0), 0)); },
    prodFormItemCost() { return U.round2((this.prodForm.items || []).reduce((a, it) => a + Number(it.amount || 0), 0)); },
    prodFormCostPrice() { const q = Number(this.prodForm.qty) || 0; return q > 0 ? U.round2((this.prodFormItemCost + (Number(this.prodForm.laborFee) || 0)) / q) : 0; },
    prodFormAmount() { return U.round2(this.prodFormCostPrice * (Number(this.prodForm.qty) || 0)); }
  },
  methods: {
    fmtMoney: U.fmtMoney, fmtNum: U.fmtNum,

    /* ---------- 生产组装 ---------- */
    openProdNew() {
      this.editingProd = null;
      this.prodForm = {
        goodsId: '', goodsName: '', typeId: '', unitId: '', supplierId: this.selfSupplierId || '', sku: '',
        items: [], laborFee: 0, qty: null, retailPrice: null, bigPrice: null, wholesalePrice: null,
        shelfLife: 0, expireWarn: 0, whId: '', batchNo: S.genScBatch(), time: U.today(), remark: ''
      };
      this.prodBase = {};
      this.showProdForm = true;
    },
    openProdEdit(p) {
      this.editingProd = p;
      this.prodForm = {
        goodsId: p.goodsId || '', goodsName: p.goodsName, typeId: p.typeId, unitId: p.unitId,
        supplierId: p.supplierId || (this.selfSupplierId || ''), sku: p.sku || '',
        items: (p.items || []).map(it => ({ ...it })),
        laborFee: p.laborFee || 0, qty: p.qty, retailPrice: p.retailPrice, bigPrice: p.bigPrice, wholesalePrice: p.wholesalePrice,
        shelfLife: p.shelfLife || 0, expireWarn: p.expireWarn || 0, whId: p.whId,
        batchNo: p.batchNo, time: p.time, remark: p.remark || ''
      };
      this.prodBase = this._snapBase();
      this.showProdForm = true;
    },
    saveProd() {
      const f = this.prodForm;
      if (!f.goodsName || !f.goodsName.trim()) return alert('请填写新商品名称');
      if (!f.typeId) return alert('请选择商品类型');
      if (!f.unitId) return alert('请选择商品单位');
      if (!f.qty || f.qty <= 0) return alert('请填写生产数量');
      if (f.retailPrice == null || f.retailPrice < 0) return alert('请填写零售价');
      if (!f.whId) return alert('请选择入库仓库');
      if (!f.batchNo) return alert('批次号不能为空');
      const items = (f.items || []).map(it => ({
        whId: it.whId, goodsId: it.goodsId, unitId: it.unitId,
        qty: Number(it.qty) || 0, price: Number(it.price) || 0,
        amount: U.round2(Number(it.amount) || 0),
        batchNo: (it.batchNo && it.batchNo !== '__NONE__') ? it.batchNo : null,
        productionDate: it.productionDate || null, shelfLife: Number(it.shelfLife) || 0,
        expiryDate: it.expiryDate || null, remark: it.remark || '', goodsName: S.name('goods', it.goodsId)
      }));
      const data = {
        goodsId: f.goodsId || '', goodsName: f.goodsName.trim(), typeId: f.typeId, unitId: f.unitId, supplierId: f.supplierId || null, sku: f.sku || '',
        items, laborFee: Number(f.laborFee) || 0, qty: Number(f.qty),
        costPrice: this.prodFormCostPrice, amount: this.prodFormAmount,
        retailPrice: Number(f.retailPrice), bigPrice: Number(f.bigPrice) || Number(f.retailPrice), wholesalePrice: Number(f.wholesalePrice) || Number(f.retailPrice),
        shelfLife: Number(f.shelfLife) || 0, expireWarn: Number(f.expireWarn) || 0,
        whId: f.whId, batchNo: f.batchNo, time: f.time, remark: f.remark || '',
        syncDirty: this.prodSyncDirty()
      };
      if (this.editingProd) {
        const err = S.updateProduction(this.editingProd.id, data);
        if (err) return alert(err);
      } else {
        S.addProduction(data);
      }
      this.showProdForm = false; this.editingProd = null;
    },
    /* 成品字段同步：下拉选商品 → 带入商品管理对应字段到表单并记基线；手改字段完工回写 goods */
    prodGoodsOpts() {
      return [{ value: '', label: '不选（直接填写新商品）' }].concat(S.enabled('goods').map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })));
    },
    onProdGoodsPick(id) {
      this.prodForm.goodsId = id || '';
      const g = id ? S.byId('goods', id) : null;
      if (g) {
        PROD_SYNC_FIELDS.forEach(f => {
          this.prodForm[f] = (f === 'wholesalePrice') ? (g.wholePrice || 0)
            : (f === 'shelfLife' || f === 'expireWarn') ? (Number(g[f]) || 0)
              : (f === 'sku') ? (g.sku || '')
                : (f === 'supplierId') ? (g.supplierId || '')
                  : (f === 'typeId' || f === 'unitId') ? (g[f] || '')
                    : (Number(g[f]) || 0);
        });
        this.prodForm.goodsName = g.name;
      }
      this.prodBase = this._snapBase();
    },
    onProdNameInput() {
      const g = this.prodForm.goodsId ? S.byId('goods', this.prodForm.goodsId) : null;
      if (g && (this.prodForm.goodsName || '').trim() !== g.name) this.prodForm.goodsId = '';
    },
    _snapBase() { const o = {}; PROD_SYNC_FIELDS.forEach(f => { o[f] = this.prodForm[f]; }); return o; },
    prodSyncDirty() {
      const base = this.prodBase || {};
      const norm = v => (v == null ? '' : v);
      return PROD_SYNC_FIELDS.filter(f => norm(this.prodForm[f]) !== norm(base[f]));
    },
    completeProd(p) {
      if (!U.confirm('完成后将消耗原材料库存、生成新商品「' + p.goodsName + '」并入库，确定完成吗？')) return;
      const err = S.completeProduction(p.id); if (err) alert(err);
    },
    delProd(p) {
      const msg = p.status === '已完成' ? '已完成的生产单删除将回滚原材料库存与成品入库，确定删除吗？' : '确定删除该生产单吗？';
      if (!U.confirm(msg)) return;
      const err = S.deleteProduction(p.id); if (err) alert(err);
    },
    exportProd() {
      U.exportExcel('生产组装明细.xlsx', this.prodRows.map((p, i) => ({
        '序号': i + 1, '商品名称': p.goodsName, '商品类型': S.name('goodsTypes', p.typeId),
        '商品单位': S.name('units', p.unitId), '供应商': S.name('suppliers', p.supplierId), 'SKU': p.sku || '',
        '生产数量': p.qty, '成本价': p.costPrice, '金额': p.amount, '零售价': p.retailPrice, '大客价': p.bigPrice, '批发价': p.wholesalePrice,
        '生产工费': p.laborFee, '入库仓库': S.name('warehouses', p.whId), '批次号': p.batchNo, '生产时间': p.time,
        '状态': p.status, '备注': p.remark || ''
      })));
    },
    /* 所需商品清单（BOM）子表 */
    addProdItem() {
      this.prodForm.items.push({ whId: '', goodsId: '', unitId: '', qty: null, price: null, amount: 0, batchNo: '', productionDate: '', shelfLife: 0, expiryDate: '', remark: '' });
    },
    delProdItem(idx) { this.prodForm.items.splice(idx, 1); },
    recalcItem(it) { it.amount = U.round2((Number(it.qty) || 0) * (Number(it.price) || 0)); },
    onProdItemWh(it) { it.goodsId = ''; it.batchNo = ''; it.unitId = ''; it.price = null; it.productionDate = ''; it.shelfLife = 0; it.expiryDate = ''; },
    onProdItemGoods(it) {
      it.batchNo = ''; it.price = null; it.productionDate = ''; it.shelfLife = 0; it.expiryDate = ''; it.goodsName = '';
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      if (g) { it.unitId = g.unitId; it.goodsName = g.name; }
    },
    onProdItemBatch(it) {
      const realBatch = (it.batchNo && it.batchNo !== '__NONE__') ? it.batchNo : null;
      const g = it.goodsId ? S.byId('goods', it.goodsId) : null;
      const rec = it.whId ? S.stockRec(it.whId, it.goodsId, false) : null;
      const lot = rec && rec.lots ? rec.lots.find(l => l.batchNo === realBatch) : null;
      if (lot) { it.price = lot.cost; it.productionDate = lot.productionDate || ''; }
      else if (g) { it.price = g.purchasePrice; it.productionDate = ''; }
      if (g) { it.shelfLife = g.shelfLife || 0; it.expiryDate = (lot && lot.productionDate) ? U.addDays(lot.productionDate, g.shelfLife || 0) : ''; }
      this.recalcItem(it);
    },
    prodItemGoodsOpts(whId) {
      if (!whId) return [{ value: '', label: '请先选择源仓库' }];
      const ids = new Set(S.db.stocks.filter(s => s.whId === whId && s.qty > 0).map(s => s.goodsId));
      return [{ value: '', label: '请选择商品' }].concat(S.enabled('goods').filter(g => ids.has(g.id)).map(g => ({ value: g.id, label: g.sku ? g.name + '（' + g.sku + '）' : g.name })));
    },
    prodItemBatchOpts(it) {
      if (!it.whId || !it.goodsId) return [{ value: '', label: '请选择批次' }];
      const rec = S.stockRec(it.whId, it.goodsId, false);
      if (!rec || !rec.lots || !rec.lots.length) return [{ value: '', label: '无批次库存' }];
      return [{ value: '', label: '请选择批次' }].concat(rec.lots.filter(l => l.qty > 0)
        .sort((a, b) => (a.productionDate || '').localeCompare(b.productionDate || ''))
        .map(l => ({ value: l.batchNo == null ? '__NONE__' : l.batchNo, label: (l.batchNo || '未分批次') + ' / 余 ' + l.qty })));
    },
    /* BOM 行：显示对应商品批次在当前源仓库的库存余量（未选批次则显示该商品总库存） */
    prodItemBatchStock(it) {
      if (!it.whId || !it.goodsId) return null;
      const rec = S.stockRec(it.whId, it.goodsId, false);
      if (!rec || !rec.lots || !rec.lots.length) return 0;
      const realBatch = (it.batchNo && it.batchNo !== '__NONE__') ? it.batchNo : null;
      if (realBatch) {
        const lot = rec.lots.find(l => l.batchNo === realBatch);
        return lot ? Number(lot.qty || 0) : 0;
      }
      return rec.lots.reduce((a, l) => a + Number(l.qty || 0), 0);
    }
  },
  template: `
  <div>
    <div class="page-title">生产组装</div>
    <div class="card">
      <div class="toolbar">
        <input type="text" v-model="prodQ.name" placeholder="商品名称模糊查询">
        <x-combobox v-model="prodQ.typeId" :options="typeOpts" style="width:140px" placeholder="商品类型"/>
        <x-combobox v-model="prodQ.whId" :options="whOpts" style="width:140px" placeholder="入库仓库"/>
        <span class="muted">生产时间</span><input type="date" v-model="prodQ.t1"> - <input type="date" v-model="prodQ.t2">
        <div class="spacer"></div>
        <span class="muted">生产数量合计 {{fmtNum(prodQtySum)}} ｜ 金额合计 ￥{{fmtMoney(prodAmountSum)}}</span>
        <button class="btn" @click="exportProd">导出</button>
        <button v-if="canProdEdit" class="btn btn-primary" @click="openProdNew">+ 新增生产单</button>
      </div>
      <div class="table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>商品名称</th><th>商品类型</th><th>商品单位</th><th>供应商</th><th>SKU</th>
          <th class="num">生产数量</th><th class="num">成本价</th><th class="num">金额</th>
          <th class="num">零售价</th><th class="num">大客价</th><th class="num">批发价</th>
          <th class="num">生产工费</th><th>入库仓库</th><th>批次号</th><th>生产时间</th><th>状态</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(p,i) in prodPaged" :key="p.id">
            <td data-label="序号">{{(prodPage-1)*prodSize+i+1}}</td>
            <td data-label="商品名称">{{p.goodsName}}</td>
            <td data-label="商品类型">{{S.name('goodsTypes',p.typeId)}}</td>
            <td data-label="商品单位">{{S.name('units',p.unitId)}}</td>
            <td data-label="供应商">{{S.name('suppliers',p.supplierId)}}</td>
            <td data-label="SKU">{{p.sku||'-'}}</td>
            <td class="num" data-label="生产数量">{{p.qty}}</td>
            <td class="num money" data-label="成本价">{{fmtMoney(p.costPrice)}}</td>
            <td class="num money" data-label="金额">{{fmtMoney(p.amount)}}</td>
            <td class="num money" data-label="零售价">{{fmtMoney(p.retailPrice)}}</td>
            <td class="num money" data-label="大客价">{{fmtMoney(p.bigPrice)}}</td>
            <td class="num money" data-label="批发价">{{fmtMoney(p.wholesalePrice)}}</td>
            <td class="num money" data-label="生产工费">{{fmtMoney(p.laborFee)}}</td>
            <td data-label="入库仓库">{{S.name('warehouses',p.whId)}}</td>
            <td data-label="批次号">{{p.batchNo}}</td>
            <td data-label="生产时间">{{p.time}}</td>
            <td data-label="状态"><x-status :v="p.status"/></td>
            <td data-label="备注">{{p.remark||'-'}}</td>
            <td class="ops" data-label="操作"><template v-if="canProdEdit">
              <span v-if="p.status!=='已完成'" class="link" @click="openProdEdit(p)">修改</span>
              <span v-if="p.status!=='已完成'" class="link danger" @click="delProd(p)">删除</span>
              <span v-if="p.status!=='已完成'" class="link green" @click="completeProd(p)">完成</span>
              <span v-if="p.status==='已完成'" class="link warn" @click="delProd(p)">删除(回滚)</span>
            </template><span v-else class="muted">查看</span></td>
          </tr>
          <tr v-if="!prodPaged.length"><td colspan="19" class="empty">暂无生产单记录</td></tr>
        </tbody>
      </table>
      </div>
      <x-pager :total="prodRows.length" v-model:page="prodPage" v-model:size="prodSize"/>
    </div>

    <!-- 生产组装弹窗 -->
    <x-modal v-if="showProdForm" :title="editingProd?'修改生产单':'新增生产单'" :width="1100" :fullscreen="$root.isMobile" position="bottom" @close="showProdForm=false">
      <div style="font-weight:600;margin:4px 0 8px;color:#334155">新商品信息（完成后同步至商品管理）</div>
      <div class="form-grid">
        <div class="form-item" style="grid-column:1/-1"><label>商品名称<b class="req">*</b></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <x-combobox v-model="prodForm.goodsId" :options="prodGoodsOpts()" style="min-width:240px;flex:1" placeholder="选择已有商品（可不选）" @update:modelValue="onProdGoodsPick"/>
            <input type="text" v-model="prodForm.goodsName" @input="onProdNameInput" placeholder="或输入新商品名称" style="min-width:200px;flex:1">
          </div>
          <div class="form-hint" style="margin-top:4px">下拉选择已有商品将自动带入类型/单位/价格/保质期等字段；不选择则直接填写新商品，完工后自动进入商品管理。手改任一字段，完工时仅回写被改动的字段到商品管理。</div>
        </div>
        <div class="form-item"><label>商品类型<b class="req">*</b></label><x-combobox v-model="prodForm.typeId" :options="typeOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>商品单位<b class="req">*</b></label><x-combobox v-model="prodForm.unitId" :options="unitOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>供应商（默认自营）</label><x-combobox v-model="prodForm.supplierId" :options="supplierOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>SKU</label><input type="text" v-model="prodForm.sku"></div>
      </div>

      <div style="font-weight:600;margin:14px 0 8px;color:#334155;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <span>所需商品清单（原材料）</span>
        <button v-if="canProdEdit" class="btn btn-primary btn-sm" @click="addProdItem">+ 添加原材料</button>
        <span class="muted">原材料总成本 ￥{{fmtMoney(prodFormItemCost)}}</span>
      </div>
      <div class="item-rows table-wrap">
      <table class="grid">
        <thead><tr>
          <th>序号</th><th>源仓库</th><th>商品名称</th><th>单位</th><th class="num">数量</th>
          <th class="num">单价</th><th class="num">金额</th><th>批次号</th><th class="num">库存余量</th><th>生产日期</th><th class="num">保质期(天)</th><th>到期时间</th><th>备注</th><th>操作</th>
        </tr></thead>
        <tbody>
          <tr v-for="(it,idx) in prodForm.items" :key="idx">
            <td data-label="序号">{{idx+1}}</td>
            <td data-label="源仓库"><x-combobox v-model="it.whId" :options="whPickOpts" style="width:100%;max-width:130px" @update:modelValue="$nextTick(()=>onProdItemWh(it))"/></td>
            <td data-label="商品名称"><x-combobox v-model="it.goodsId" :options="prodItemGoodsOpts(it.whId)" style="width:100%;max-width:170px" @update:modelValue="$nextTick(()=>onProdItemGoods(it))"/></td>
            <td data-label="单位">{{S.name('units', it.unitId)}}</td>
            <td data-label="数量"><input type="number" min="1" style="width:60px" v-model.number="it.qty" @change="recalcItem(it)"></td>
            <td data-label="单价"><input type="number" min="0" step="0.01" style="width:70px" v-model.number="it.price" @change="recalcItem(it)"></td>
            <td data-label="金额"><input type="number" min="0" step="0.01" style="width:80px" v-model.number="it.amount" @change="it.amount=U.round2(Number(it.amount)||0)"></td>
            <td data-label="批次号"><x-combobox v-model="it.batchNo" :options="prodItemBatchOpts(it)" style="width:100%;max-width:150px" @update:modelValue="$nextTick(()=>onProdItemBatch(it))"/></td>
            <td class="num money" data-label="库存余量">{{ it.whId && it.goodsId ? prodItemBatchStock(it) + ' ' + S.name('units', it.unitId) : '-' }}</td>
            <td data-label="生产日期">{{it.productionDate||'-'}}</td>
            <td data-label="保质期(天)">{{it.shelfLife||0}}</td>
            <td data-label="到期时间">{{it.expiryDate||'-'}}</td>
            <td data-label="备注"><input type="text" style="width:80px" v-model="it.remark"></td>
            <td class="ops" data-label="操作"><span class="link danger" @click="delProdItem(idx)">删除</span></td>
          </tr>
          <tr v-if="!prodForm.items.length"><td colspan="14" class="empty">请添加所需原材料</td></tr>
        </tbody>
      </table>
      </div>

      <div style="font-weight:600;margin:14px 0 8px;color:#334155">生产核算</div>
      <div class="form-grid">
        <div class="form-item"><label>生产工费</label><input type="number" min="0" step="0.01" v-model.number="prodForm.laborFee"></div>
        <div class="form-item"><label>生产数量<b class="req">*</b></label><input type="number" min="1" v-model.number="prodForm.qty"></div>
        <div class="form-item"><label>成本价（自动核算）</label><input type="text" :value="fmtMoney(prodFormCostPrice)" disabled></div>
        <div class="form-item"><label>金额（自动核算）</label><input type="text" :value="fmtMoney(prodFormAmount)" disabled></div>
        <div class="form-item"><label>零售价<b class="req">*</b></label><input type="number" min="0" step="0.01" v-model.number="prodForm.retailPrice"></div>
        <div class="form-item"><label>大客价</label><input type="number" min="0" step="0.01" v-model.number="prodForm.bigPrice"></div>
        <div class="form-item"><label>批发价</label><input type="number" min="0" step="0.01" v-model.number="prodForm.wholesalePrice"></div>
        <div class="form-item"><label>保质期(天)</label><input type="number" min="0" v-model.number="prodForm.shelfLife" placeholder="0=永不过期"></div>
        <div class="form-item"><label>临期提醒(天)</label><input type="number" min="0" v-model.number="prodForm.expireWarn" placeholder="0=不提醒"></div>
        <div class="form-item"><label>入库仓库<b class="req">*</b></label><x-combobox v-model="prodForm.whId" :options="whPickOpts" placeholder="请选择"/></div>
        <div class="form-item"><label>批次号（自动生成）</label><input type="text" v-model="prodForm.batchNo" placeholder="SC-年月日-00001"></div>
        <div class="form-item"><label>生产时间<b class="req">*</b></label><input type="date" v-model="prodForm.time"></div>
        <div class="form-item full"><label>备注</label><input type="text" v-model="prodForm.remark"></div>
      </div>
      <template #foot>
        <button class="btn" @click="showProdForm=false">取消</button>
        <button class="btn btn-primary" @click="saveProd">保存</button>
      </template>
    </x-modal>
  </div>`
};
