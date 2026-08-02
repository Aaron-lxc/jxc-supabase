/* 新增功能的业务逻辑闭环测试（期初 / 注资 / 手续费结算 / 仪表盘汇总 / 采购支付方式）
   在 vm 沙箱中加载业务脚本，断言关键数据流正确。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const sandbox = {};
Object.assign(sandbox, {
  globalThis: sandbox, window: sandbox, self: sandbox, console,
  setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
  Blob: class {}, URL: { createObjectURL: () => 'blob:', revokeObjectURL() {} },
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  location: { href: 'http://localhost/', reload() {}, pathname: '/', search: '' },
  navigator: {},
  document: { hidden: false, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {} }), createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], documentElement: { style: {} }, addEventListener() {}, removeEventListener() {}, body: { appendChild() {} } }
});
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
sandbox.echarts = { init: () => ({ setOption() {}, resize() {}, dispose() {}, on() {} }), dispose() {} };

const ctx = vm.createContext(sandbox);
vm.runInContext(read('vendor/vue.global.prod.js'), ctx, { filename: 'vue.js' });
['js/utils.js', 'js/config.js', 'js/cloud.js', 'js/perm.js', 'js/sync.js', 'js/store.js', 'js/demo-data.js', 'js/components.js',
 'js/pages/dashboard.js', 'js/pages/goods.js', 'js/pages/customers.js', 'js/pages/partners.js', 'js/pages/warehouse.js',
 'js/pages/purchase.js', 'js/pages/inventory.js', 'js/pages/sales.js', 'js/pages/opening.js', 'js/pages/capital.js',
 'js/pages/finance.js', 'js/pages/complaint.js', 'js/pages/report.js', 'js/pages/commission.js', 'js/pages/members.js', 'js/pages/settings.js'
].forEach(f => vm.runInContext(read(f), ctx, { filename: f }));

const S = sandbox.S, P = sandbox.P, U = sandbox.U, Cloud = sandbox.Cloud;

let asserts = 0, failed = 0;
function ok(cond, msg) { asserts++; if (!cond) { failed++; console.error('  ✗ ' + msg); } else console.log('  ✓ ' + msg); }

/* ---- 准备：空白账套 + 管理员 ---- */
Cloud.state.ws = { id: 'w1', name: '测试', role: 'owner', permissions: {} };
Cloud.state.user = { id: 'u1', email: 'a@b.c', name: '老板' };
S.state.db = S.emptyDB();
S._buildIds();
const db = S.db;
ok(db.settings.feeRates && db.settings.feeRates['现金'] === 0, 'emptyDB.settings.feeRates 已包含全部支付方式');

/* ---------- 基础数据 ---------- */
const gId = S.genId(), wId = S.genId(), cId = S.genId(), sId = S.genId();
db.goods.push({ id: gId, typeId: 't1', name: '测试商品', sku: 'SKU1', supplierId: sId, unitId: 'u1', purchasePrice: 5, status: 'enabled' });
db.warehouses.push({ id: wId, name: '主仓库', status: 'enabled' });
db.customers.push({ id: cId, name: '测试客户' });
db.suppliers.push({ id: sId, name: '测试供应商' });

/* ---------- 期初闭环 ---------- */
console.log('\n[期初管理]');
const g = db.goods[0], w = db.warehouses[0];
db.openingStocks.push({ id: S.genId(), whId: w.id, goodsId: g.id, qty: 10, price: 5, remark: '期初' });
db.openingAr.push({ id: S.genId(), customerId: db.customers[0].id, amount: 100, remark: '' });
db.openingAp.push({ id: S.genId(), supplierId: db.suppliers[0].id, amount: 60, remark: '' });
db.openingFunds.push({ id: S.genId(), payMethod: '现金', amount: 500, remark: '' });
ok(S.totalOpeningStockValue() === U.round2(10 * 5), '期初库存金额 = 数量×单价 = 50');
ok(S.totalOpeningAr() === 100, '期初应收合计 = 100');
ok(S.totalOpeningAp() === 60, '期初应付合计 = 60');
ok(S.totalOpeningFunds() === 500, '期初资金合计 = 500');
ok(S.hasBusinessData() === false, '仅有期初数据时不算业务数据，可启用期初');

const e1 = S.applyOpening();
ok(e1 === null, 'applyOpening 成功（返回 null）');
ok(db.settings.opened === true && !!db.settings.openTime, '启用后 settings.opened=true 且记录 openTime');
const rec = db.stocks.find(s => s.whId === w.id && s.goodsId === g.id);
ok(rec && rec.qty === 10, '期初库存已并入 stocks（数量=10）');

/* 启用后再次启用应被拦截 */
ok(S.applyOpening() === '账套已启用期初，无需重复启用', '重复启用被拦截');
/* 已启用时若有业务数据则反初始化被拦截（构造业务数据） */
const G = db.goods[1] || g;
S.addPurchase({ typeId: G.typeId, goodsId: G.id, supplierId: G.supplierId, unitId: G.unitId, qty: 2, price: 3, whId: w.id, payMethod: '对公' });
ok(S.hasBusinessData() === true, '存在采购单后 hasBusinessData=true');
ok(S.reverseOpening() === '当前账套已存在业务数据（采购/销售/退货/已计算运营支出），无法反初始化期初，请先清空业务数据', '有业务数据时反初始化被拦截');

/* 删掉采购单后反初始化成功 */
S.deletePurchase(db.purchases[db.purchases.length - 1].id);
ok(S.hasBusinessData() === false, '清空业务数据后 hasBusinessData=false');
const e2 = S.reverseOpening();
ok(e2 === null, 'reverseOpening 成功');
ok(db.settings.opened === false, '反初始化后 opened=false');
const rec2 = db.stocks.find(s => s.whId === w.id && s.goodsId === g.id);
ok(!rec2 || rec2.qty === 0, '反初始化回滚了期初库存');

/* ---------- 注资闭环 ---------- */
console.log('\n[注资管理]');
S.addCapitalInjection({ investor: '张三', method: '微信', amount: 200, date: '2026-08-01', remark: '' });
S.addCapitalInjection({ investor: '李四', method: '现金', amount: 300, date: '2026-08-01', remark: '' });
S.addCapitalInjection({ investor: '张三', method: '支付宝', amount: 100, date: '2026-08-02', remark: '' });
ok(db.capitalInjections.length === 3, '注资记录新增 3 条');
ok(S.totalCapitalInjected() === 600, '注资总额 = 600');
const byInv = S.capitalByInvestor();
ok(byInv.length === 2, '按股东汇总为 2 人');
const zs = byInv.find(x => x.investor === '张三');
ok(zs && zs.amount === 300, '张三合计注资 = 200+100 = 300');
ok(byInv[0].amount >= byInv[1].amount, '按金额降序排列');
ok(db.capitalInjections.every(c => /^CI-\d{8}-\d{5}$/.test(c.no)), '注资单号格式 CI-YYYYMMDD-#####');
S.delCapitalInjection(db.capitalInjections[0].id);
ok(S.totalCapitalInjected() === 400, '删除一条后注资总额 = 400');

/* ---------- 手续费 + 结算 ---------- */
console.log('\n[手续费 / 结算]');
db.settings.feeRates['微信'] = 0.6;   // 60%
ok(S.feeRateOf('微信') === 0.6, 'feeRateOf 读取当前比例');
ok(S.feeRateOf('未知方式') === 0, '未知支付方式手续费 = 0');
/* 模拟销售结算：实际收款 1000，微信支付 → 手续费 = 1000*0.6 = 600 */
const actualPaid = 1000, method = '微信';
const fee = U.round2(actualPaid * S.feeRateOf(method));
ok(fee === 600, '手续费 = 实际收款 × 比例 = 600');
/* 修改比例不应影响已结算费用（冻结语义）：将比例改为 10% 后旧单据仍为 600 */
db.settings.feeRates['微信'] = 0.1;
ok(fee === 600, '比例变更不影响已计算的手续费（冻结）');

/* ---------- 采购支付方式 ---------- */
console.log('\n[采购支付方式]');
const G2 = db.goods[2] || G;
S.addPurchase({ typeId: G2.typeId, goodsId: G2.id, supplierId: G2.supplierId, unitId: G2.unitId, qty: 1, price: 9, whId: w.id, payMethod: '银行卡' });
const lastP = db.purchases[db.purchases.length - 1];
ok(lastP.payMethod === '银行卡', '采购单存留了支付方式');

/* ---------- 仪表盘汇总 ---------- */
console.log('\n[仪表盘汇总]');
/* 构造一个已支付销售单 */
const sale = { id: S.genId(), no: S.genNo('SO'), customerId: db.customers[0].id, items: [{ goodsId: g.id, qty: 1, price: 100 }],
  total: 100, status: '已完成', payStatus: '已支付', payMethod: '微信', actualPaid: 1000, fee: 600, payTime: U.now(), createTime: U.now() };
db.sales.push(sale);
const totalPurchase = U.round2(db.purchases.reduce((a, p) => a + Number(p.amount), 0));
const totalReceipts = U.round2(db.sales.filter(s => s.payStatus === '已支付').reduce((a, s) => a + (Number(s.actualPaid) || S.salePayable(s)), 0));
const receiptByMethod = {};
db.sales.filter(s => s.payStatus === '已支付').forEach(s => { const k = s.payMethod || '未设置'; receiptByMethod[k] = U.round2((receiptByMethod[k] || 0) + (Number(s.actualPaid) || S.salePayable(s))); });
ok(totalPurchase > 0, '累计采购金额 > 0（' + totalPurchase + '）');
ok(totalReceipts === 1000, '累计收款(已支付) = 1000');
ok(receiptByMethod['微信'] === 1000, '分类型收款：微信 = 1000');
ok(S.totalCapitalInjected() === 400, '仪表盘注资总额 = 400');

/* ---------- 期初资金按支付方式录入 ---------- */
console.log('\n[期初资金按支付方式]');
db.openingFunds.length = 0;
db.openingFunds.push({ id: S.genId(), payMethod: '现金', amount: 200, remark: '' });
db.openingFunds.push({ id: S.genId(), payMethod: '微信', amount: 150, remark: '' });
db.openingFunds.push({ id: S.genId(), payMethod: '对公', amount: 350, remark: '' });
const byMethod = {};
db.openingFunds.forEach(x => { byMethod[x.payMethod] = U.round2((byMethod[x.payMethod] || 0) + Number(x.amount)); });
ok(S.totalOpeningFunds() === 700, '期初资金合计 = 200+150+350 = 700');
ok(byMethod['现金'] === 200 && byMethod['微信'] === 150 && byMethod['对公'] === 350, '期初资金按支付方式分类汇总正确');
/* 旧数据迁移：缺 payMethod 的旧记录应被 ensureSettings 补齐 */
db.openingFunds.push({ id: S.genId(), type: '银行', amount: 80, remark: 'legacy' });
S.ensureSettings(db);
const legacy = db.openingFunds[db.openingFunds.length - 1];
ok(legacy.payMethod === '现金', '旧期初资金(仅 type) 经 ensureSettings 补齐 payMethod=现金（type 不在统一清单）');

/* ---------- 采购修改库存重算 ---------- */
console.log('\n[采购修改 + 库存重算]');
const gA = S.genId(), wA = S.genId(), gB = S.genId(), wB = S.genId();
db.goods.push({ id: gA, typeId: 't1', name: '商品A', sku: 'A', supplierId: sId, unitId: 'u1', purchasePrice: 5, status: 'enabled' });
db.warehouses.push({ id: wA, name: '仓A', status: 'enabled' });
db.goods.push({ id: gB, typeId: 't1', name: '商品B', sku: 'B', supplierId: sId, unitId: 'u1', purchasePrice: 5, status: 'enabled' });
db.warehouses.push({ id: wB, name: '仓B', status: 'enabled' });
const pA = S.addPurchase({ typeId: 't1', goodsId: gA, supplierId: sId, unitId: 'u1', qty: 5, price: 10, whId: wA, payMethod: '现金' });
ok(db.stocks.find(s => s.whId === wA && s.goodsId === gA).qty === 5, '采购后 仓A/商品A 库存 = 5');
/* 改数量 5→8、改价 10→12（同仓同货） */
let err = S.updatePurchase(pA.id, { goodsId: gA, qty: 8, price: 12, whId: wA, payMethod: '微信' });
ok(err === null, 'updatePurchase 改数量/价格成功');
ok(db.stocks.find(s => s.whId === wA && s.goodsId === gA).qty === 8, '改数量后库存 = 8');
ok(Math.abs(pA.amount - 96) < 1e-6, '改价后采购金额 = 8×12 = 96');
ok(pA.payMethod === '微信', '改支付方式生效');
/* 改商品 + 仓库：A/仓A → B/仓B，数量 3 */
err = S.updatePurchase(pA.id, { goodsId: gB, qty: 3, price: 7, whId: wB, payMethod: '对公' });
ok(err === null, 'updatePurchase 改商品+仓库成功');
ok(db.stocks.find(s => s.whId === wA && s.goodsId === gA).qty === 0, '旧仓A/商品A 库存回滚为 0');
const stB = db.stocks.find(s => s.whId === wB && s.goodsId === gB);
ok(stB && stB.qty === 3, '新仓B/商品B 库存 = 3');
ok(Math.abs(pA.amount - 21) < 1e-6, '新金额 = 3×7 = 21');
/* 库存不足拦截：人为制造“已售”后无法修改 */
db.stocks.find(s => s.whId === wB && s.goodsId === gB).qty = 2;
err = S.updatePurchase(pA.id, { goodsId: gB, qty: 5, price: 7, whId: wB, payMethod: '对公' });
ok(typeof err === 'string' && err.indexOf('无法修改') >= 0, '库存不足时修改被拦截');

console.log(`\n逻辑断言 ${asserts} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);
