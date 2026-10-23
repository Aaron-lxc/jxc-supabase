/* 业务逻辑单元测试 harness
 * 通过 shim(window/Vue/Sync/Cloud) 直接加载浏览器版 store.js / utils.js，
 * 并对核心业务算法做断言；同时直接 require compute-core.js 验证统计闭环。
 * 运行：node test/business.test.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

/* ---------- shim 浏览器环境 ---------- */
global.window = global;
global.document = {
  createElement: () => ({ click() {}, set href(v) {}, set download(v) {} }),
  getElementById: () => ({ set innerHTML(v) {} }),
  head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} }
};
global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
global.alert = () => {};
global.Vue = {
  reactive: (o) => o,
  ref: (v) => ({ value: v }),
  computed: (f) => ({ get value() { return f(); } })
};

/* 加载 utils.js → window.U（含 fmtMoney/kw/round2/esc 等） */
eval(fs.readFileSync(path.join(ROOT, 'js/utils.js'), 'utf8'));

/* shim Sync（持久化层，离线测试不触网） */
const COLL_NAMES = ['goodsTypes', 'units', 'suppliers', 'goods', 'custLevels', 'custTypes',
  'regions', 'customers', 'resourcePartners', 'regionPartners', 'warehouses', 'purchases',
  'stocks', 'stockChecks', 'losses', 'overflows', 'sales', 'returns', 'transfers',
  'productions', 'expenseCats', 'expenses', 'incomeCats', 'incomes', 'complaintTypes',
  'complaints', 'rewardTypes', 'rewards', 'dealerRewards', 'merchantRefs', 'personRefs',
  'personPromos', 'recommenderBindings', 'regionAssessArchive', 'resourceRates', 'regionRates', 'commissionPayments',
  'openingStocks', 'openingAr', 'openingAp', 'openingFunds', 'capitalInjections'];
global.Sync = {
  COLLS: COLL_NAMES,
  schedule() {}, push() { return Promise.resolve(); }, pushAll() { return Promise.resolve(); },
  loadAll() { return Promise.resolve({ db: null, empty: true }); }, start() {}, stop() {},
  resetShadow() {}, wipeRemote() { return Promise.resolve(); }
};
global.Cloud = { state: { user: { name: 'Tester' } } };
global.Demo = undefined;

/* 加载 store.js → window.S */
eval(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'));
const S = global.S;
/* 覆盖 id/单号生成器为递增桩（避免依赖 _buildIds/init） */
let _seq = 1;
S.genId = () => 'id' + (_seq++);
S.genNo = (p) => p + '-0001';
S.genCode = (p) => p + '-1';

/* ---------- 断言框架 ---------- */
let pass = 0, fail = 0;
const fails = [];
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; fails.push(`✗ ${msg}\n    期望: ${e}\n    实际: ${a}`); }
}
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(`✗ ${msg}（条件为假）`); } }

/* 重置测试库 */
function reset() {
  S.state.db = S.emptyDB();
  const db = S.db;
  db.goodsTypes.push({ id: 1, name: '日化' });
  db.units.push({ id: 1, name: '袋' }, { id: 2, name: '个' });
  db.warehouses.push({ id: 'W1', name: '总仓' }, { id: 'W2', name: '分仓' });
  db.goods.push(
    { id: 'G1', name: '洗洁精', purchasePrice: 10, retailPrice: 15, shelfLife: 30, expireWarn: 7 },
    { id: 'G2', name: '原料A', purchasePrice: 5, retailPrice: 8, shelfLife: 0, expireWarn: 0 },
    { id: 'G3', name: '原料B', purchasePrice: 2, retailPrice: 4, shelfLife: 0, expireWarn: 0 },
    { id: 'G4', name: '报损品', purchasePrice: 1, retailPrice: 2, shelfLife: 0, expireWarn: 0 }
  );
  return db;
}

/* =================== A. 批次库存 FEFO =================== */
(function () {
  const db = reset();
  const g = S.byId('goods', 'G1');
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'B1', productionDate: '2026-01-01', cost: 10 }, 100);
  S.addLotQty(rec, { batchNo: 'B2', productionDate: '2026-02-01', cost: 10 }, 50);
  eq(rec.qty, 150, 'A1 addLotQty 后 rec.qty 累加=150');
  // FEFO 排序：B1(到期01-31) 先于 B2(到期03-02)
  const sorted = S._sortLotsFEFO(g, rec.lots);
  eq(sorted[0].batchNo, 'B1', 'A2 FEFO 排序最老批次 B1 在最前');
  // 不指定批次扣 30 → 扣 B1
  S.consumeLotSelected(rec, g, 30, null);
  eq(rec.qty, 120, 'A3 默认消费后 rec.qty=120');
  eq(rec.lots.find(l => l.batchNo === 'B1').qty, 70, 'A4 B1 余量=70');
  // 指定 B2 扣 50 → B2 清空并被过滤
  const alloc = S.consumeLotSelected(rec, g, 50, 'B2');
  eq(rec.lots.some(l => l.batchNo === 'B2'), false, 'A5 指定批次扣空后从 lots 移除');
  eq(rec.qty, 70, 'A6 消费后 rec.qty=70');
  eq(alloc.map(a => a.batchNo), ['B2'], 'A7 指定批次 alloc 仅含 B2');
  // 指定不存在批次 → 走 FEFO（用独立仓/商品避免与上面 rec 复用）
  const rec2 = S.stockRec('W2', 'G4', true);
  S.addLotQty(rec2, { batchNo: 'X1', productionDate: '2026-03-01', cost: 10 }, 10);
  S.addLotQty(rec2, { batchNo: 'X2', productionDate: '2026-01-01', cost: 10 }, 10);
  const a2 = S.consumeLotSelected(rec2, S.byId('goods', 'G4'), 4, 'NOPE');
  eq(a2[0].batchNo, 'X2', 'A8 指定不存在批次时回退 FEFO 最老 X2');
  // 临期判定（expiry 距今天<=expireWarn 天；用相对日期避免随时间腐烂）
  const ei = S.lotExpiryInfo(g, { productionDate: U.addDays(U.today(), -23), qty: 1 }); // 到期=今天+7
  ok(ei.expiring === true && ei.days === 7, 'A9 到期日距今天7天 → 临期=true');
  const ei2 = S.lotExpiryInfo(g, { productionDate: U.addDays(U.today(), -5), qty: 1 }); // 到期=今天+25
  ok(ei2.expiring === false, 'A10 距到期25天 → 不临期');
  // opened 批次优先
  const rec3 = S.stockRec('W1', 'G3', true);
  S.addLotQty(rec3, { batchNo: 'O1', productionDate: '2026-09-01', cost: 2 }, 5);
  S.addLotQty(rec3, { batchNo: 'O2', productionDate: '2026-01-01', cost: 2 }, 5, );
  rec3.lots.find(l => l.batchNo === 'O1').opened = true;
  const so = S._sortLotsFEFO(S.byId('goods', 'G3'), rec3.lots);
  eq(so[0].batchNo, 'O1', 'A11 opened 批次永远最前（期初最先出）');
})();

/* =================== A2. 采购修改/删除不可吞噬期初批次 =================== */
(function () {
  const db = reset();
  const rec = S.stockRec('W1', 'G1', true);
  // 期初批次（opened 标记，FEFO 优先）
  S.addLotQty(rec, { batchNo: 'OP-1', productionDate: '2026-09-01', cost: 16, opened: true }, 258);
  // 采购批次 299
  const p = S.addPurchase({ whId: 'W1', items: [{ goodsId: 'G1', qty: 299, price: 18, batchNo: 'PO-0001', productionDate: '2026-10-17' }] });
  eq(rec.qty, 557, 'A2-1 初期合计 258+299=557');
  eq(rec.lots.find(l => l.batchNo === 'OP-1').qty, 258, 'A2-2 期初批次独立 258');
  // 修改采购单（数量不变，仅改价/日期）：根因场景
  const err = S.updatePurchase(p.id, { whId: 'W1', items: [{ goodsId: 'G1', qty: 299, price: 18, batchNo: 'PO-0001', productionDate: '2026-10-17' }] });
  eq(err, null, 'A2-3 updatePurchase 返回成功');
  eq(rec.lots.find(l => l.batchNo === 'OP-1').qty, 258, 'A2-4 修改采购单后期初批次仍为 258（不被 FEFO 吞噬）');
  eq(rec.lots.find(l => l.batchNo === 'PO-0001').qty, 299, 'A2-5 采购批次仍为 299');
  eq(rec.qty, 557, 'A2-6 合计不变 557');
  // 数量增大的修改：回滚本批次后再加，期初不受影响
  S.updatePurchase(p.id, { whId: 'W1', items: [{ goodsId: 'G1', qty: 350, price: 18, batchNo: 'PO-0001', productionDate: '2026-10-17' }] });
  eq(rec.lots.find(l => l.batchNo === 'OP-1').qty, 258, 'A2-7 增大采购量后期初仍为 258');
  eq(rec.lots.find(l => l.batchNo === 'PO-0001').qty, 350, 'A2-8 采购批次变 350');
  // 删除采购单：应扣本批次，期初不动
  const p2 = S.addPurchase({ whId: 'W1', items: [{ goodsId: 'G1', qty: 100, price: 18, batchNo: 'PO-0002', productionDate: '2026-10-18' }] });
  eq(rec.qty, 708, 'A2-9 三批次合计 258+350+100=708');
  const derr = S.deletePurchase(p2.id);
  eq(derr, null, 'A2-10 deletePurchase 返回成功');
  eq(rec.lots.find(l => l.batchNo === 'OP-1').qty, 258, 'A2-11 删除采购单后期初仍为 258');
  eq(rec.lots.some(l => l.batchNo === 'PO-0002'), false, 'A2-12 PO-0002 已移除');
  eq(rec.qty, 608, 'A2-13 删除后合计 258+350=608');
})();

/* =================== A3. 一张采购单含多件明细（表头+items） =================== */
(function () {
  const db = reset();
  const rec1 = S.stockRec('W1', 'G1', true);
  const rec2 = S.stockRec('W1', 'G2', true);
  const p = S.addPurchase({ whId: 'W1', items: [
    { goodsId: 'G1', qty: 10, price: 5, batchNo: 'PO-A1' },
    { goodsId: 'G2', qty: 20, price: 3, batchNo: 'PO-A2' }
  ] });
  eq(typeof p, 'object', 'A3-1 addPurchase 返回对象（非错误串）');
  eq(p.items.length, 2, 'A3-2 含 2 条明细');
  eq(p.amount, U.round2(10 * 5 + 20 * 3), 'A3-3 采购费用合计 = 各明细金额之和');
  eq(rec1.lots.find(l => l.batchNo === 'PO-A1').qty, 10, 'A3-4 G1 批次库存 10');
  eq(rec2.lots.find(l => l.batchNo === 'PO-A2').qty, 20, 'A3-5 G2 批次库存 20');
  const derr = S.deletePurchase(p.id);
  eq(derr, null, 'A3-6 删除整单成功');
  eq(rec1.lots.some(l => l.batchNo === 'PO-A1'), false, 'A3-7 删除后 G1 批次已移除');
  eq(rec2.lots.some(l => l.batchNo === 'PO-A2'), false, 'A3-8 删除后 G2 批次已移除');
})();

/* =================== B. 经销商阶梯 + 预存货款 FIFO =================== */
(function () {
  const db = reset();
  db.custTypes.push({ id: 1, name: '经销商' });
  db.customers.push({ id: 'C1', name: '经销商A', typeId: 1, taxRate: 0 });
  db.settings.dealerReward = {
    tiers: [{ min: 0, max: 100, rate: 5 }, { min: 100, max: 500, rate: 10 }, { min: 500, max: '', rate: 15 }]
  };
  db.sales.push({ id: 'S1', customerId: 'C1', status: '已完成', finishTime: '2026-03-01', items: [{ goodsId: 'G1', qty: 20 }], total: 300 });
  eq(S.dealerAnnualPurchase('C1', 2026), 300, 'B1 经销商全年采购净额=300');
  eq(S.dealerAnnualPurchase('C1', 2025), 0, 'B2 非本年销售不计');
  eq(S.dealerRewardTier(50).rate, 5, 'B3 50→第1档5%');
  eq(S.dealerRewardTier(300).rate, 10, 'B4 300→第2档10%');
  eq(S.dealerRewardTier(9999).rate, 15, 'B5 超最高按最高档15%');
  eq(S.dealerRewardTier(0).rate, 5, 'B6 0→第1档');
  // 预存货款
  db.dealerRewards.push({ id: 'R1', dealerId: 'C1', year: 2025, settleType: '预存货款', rewardAmount: 100, usedAmount: 30 });
  db.dealerRewards.push({ id: 'R2', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 200, usedAmount: 0 });
  eq(S.dealerPrepaidBalance('C1'), 270, 'B7 预存货款余额=100-30+200=270');
  const r1 = S.applyPrepaidDeduct('C1', 150); // FIFO: R1 剩70 → R2 剩80
  ok(r1.ok === true, 'B8 FIFO 抵扣 150 成功');
  eq(db.dealerRewards.find(r => r.id === 'R1').usedAmount, 100, 'B9 最早记录 R1 先扣满(used=100)');
  eq(db.dealerRewards.find(r => r.id === 'R2').usedAmount, 80, 'B10 次早记录 R2 扣80');
  eq(S.dealerPrepaidBalance('C1'), 120, 'B11 抵扣后余额=(100-100)+(200-80)=120');
  // 正常回补：可用余额 +50（具体回补到哪条记录取决于排序，断言总额更稳健）
  const balB = S.dealerPrepaidBalance('C1');
  db.dealerRewards.push({ id: 'R5', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 200, usedAmount: 80 });
  const balM = S.dealerPrepaidBalance('C1');
  S.releasePrepaidDeduct('C1', 50);
  eq(S.dealerPrepaidBalance('C1'), balM + 50, 'B12 回补 50 → 可用余额 +50');
  // 反向 FIFO 用例见下方独立 IIFE（B3），避免同 year 多记录 tie-break 影响特定断言
  // 奖励报表
  const rep = S.dealerRewardReport(2026);
  ok(rep.length === 1 && rep[0].annualAmount === 300 && rep[0].rewardAmount === 30, 'B13 奖励报表:年采购300→奖励30(10%)');
})();

/* =================== B2. 预存货款余额不足风险（独立隔离） =================== */
(function () {
  const db = reset();
  db.custTypes.push({ id: 1, name: '经销商' });
  db.customers.push({ id: 'C1', name: '经销商A', typeId: 1, taxRate: 0 });
  db.dealerRewards.push({ id: 'R3', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 100, usedAmount: 0 });
  db.dealerRewards.push({ id: 'R4', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 50, usedAmount: 0 });
  const before = S.dealerPrepaidBalance('C1');
  const r = S.applyPrepaidDeduct('C1', 200); // 仅 150 可用
  ok(r.ok === false, 'B14 余额不足返回 ok:false');
  const after = S.dealerPrepaidBalance('C1');
  ok(before === 150 && after === 150, 'B15 原子性:余额不足时不改动任何 usedAmount(150→150)，调用方回滚可正确还原');
})();

/* =================== B4. 预存货款原子性（模拟 confirmSettle 改单回滚闭环，验证 R1 修复） =================== */
(function () {
  const db = reset();
  db.custTypes.push({ id: 1, name: '经销商' });
  db.customers.push({ id: 'C1', name: '经销商A', typeId: 1, taxRate: 0 });
  db.dealerRewards.push({ id: 'R3', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 100, usedAmount: 0 });
  db.dealerRewards.push({ id: 'R4', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 50, usedAmount: 0 });
  const oldDeduct = 30;
  S.applyPrepaidDeduct('C1', oldDeduct); // 旧单已抵扣 30
  eq(S.dealerPrepaidBalance('C1'), 120, 'B18 旧单抵扣30后余额=120');
  // 模拟 confirmSettle 改单：先回补旧值（余额恢复 150），再尝试扣新值 200（超额）
  S.releasePrepaidDeduct('C1', oldDeduct);            // 余额恢复 150
  const res = S.applyPrepaidDeduct('C1', 200);        // 超额 → 原子失败，不改动
  ok(res.ok === false, 'B19 改单扣 200 超额返回 ok:false');
  eq(S.dealerPrepaidBalance('C1'), 150, 'B20 失败后余额仍为 150（未被部分占用）');
  // 调用方回滚还原旧值（confirmSettle 第 829 行）
  S.applyPrepaidDeduct('C1', oldDeduct);
  eq(S.dealerPrepaidBalance('C1'), 120, 'B21 还原旧值后余额=120，预存货款未被误扣(R1已修复)');
})();

/* =================== B3. 预存货款反向 FIFO 回补（独立隔离） =================== */
(function () {
  const db = reset();
  db.dealerRewards.push({ id: 'R6', dealerId: 'C1', year: 2025, settleType: '预存货款', rewardAmount: 100, usedAmount: 100 });
  db.dealerRewards.push({ id: 'R7', dealerId: 'C1', year: 2026, settleType: '预存货款', rewardAmount: 100, usedAmount: 100 });
  S.releasePrepaidDeduct('C1', 50); // 晚记录(R7,2026)应先回补
  eq(db.dealerRewards.find(r => r.id === 'R7').usedAmount, 50, 'B16 反向FIFO:晚记录R7(2026)先回补→used=50');
  eq(db.dealerRewards.find(r => r.id === 'R6').usedAmount, 100, 'B17 早记录R6(2025)不被回补→used=100');
})();

/* =================== C. coopTime（合作时间口径） =================== */
(function () {
  const db = reset();
  db.customers.push({ id: 'C2', name: '被推荐客户', typeId: 1 });
  db.sales.push({ id: 'S2', customerId: 'C2', status: '已完成', finishTime: '2026-05-10', items: [{ goodsId: 'G1', qty: 5, unitId: 1 }] });
  db.sales.push({ id: 'S3', customerId: 'C2', status: '已完成', finishTime: '2026-04-01', items: [{ goodsId: 'G1', qty: 3, unitId: 1 }] }); // 量不足
  db.sales.push({ id: 'S4', customerId: 'C2', status: '已完成', finishTime: '2026-03-01', items: [{ goodsId: 'G1', qty: 6, unitId: 1 }] });
  eq(S.coopTime('C2'), '2026-03-01', 'C1 coopTime=含洗洁精≥5袋的最早完成时间(2026-03-01)');
  // 未达量则无合作时间
  const db2 = reset();
  db2.customers.push({ id: 'C9', name: 'x', typeId: 1 });
  db2.sales.push({ id: 'S9', customerId: 'C9', status: '已完成', finishTime: '2026-06-01', items: [{ goodsId: 'G1', qty: 2, unitId: 1 }] });
  eq(S.coopTime('C9'), '', 'C2 量不足→无合作时间');
})();

/* =================== D. 统计闭环（compute-core） =================== */
(function () {
  const CC = require(path.join(ROOT, 'js/compute-core.js'));
  const cdb = CC.buildDB([
    { coll: 'goods', data: { id: 'G1', name: '洗洁精', purchasePrice: 10, retailPrice: 15, shelfLife: 30, expireWarn: 7 } },
    { coll: 'warehouses', data: { id: 'W1', name: '仓' } },
    { coll: 'stocks', data: { id: 'ST1', goodsId: 'G1', whId: 'W1', qty: 10, lots: [{ batchNo: 'B1', productionDate: '2026-01-01', qty: 10, cost: 10 }] } },
    { coll: 'sales', data: { id: 'S1', customerId: 'C1', status: '已完成', finishTime: '2026-03-01', items: [{ goodsId: 'G1', qty: 2 }], total: 30, payStatus: '已支付', actualPaid: 30 } },
    { coll: 'expenses', data: { id: 'E1', status: '已计算', amount: 5 } },
    { coll: 'incomes', data: { id: 'I1', status: '已确认', amount: 8 } },
    { coll: 'incomes', data: { id: 'I2', status: '未确认', amount: 99 } }
  ]);
  const st = CC.makeCompute(cdb).stats();
  eq(st.invQty, 10, 'D1 库存数量=10');
  eq(st.invCost, 100, 'D2 库存成本=100');
  eq(st.invValue, 150, 'D3 库存货值=150');
  eq(st.totalSales, 30, 'D4 累计销售额=30');
  eq(st.opCost, 5, 'D5 已计算支出=5');
  eq(st.otherIncome, 8, 'D6 其他收入仅计「已确认」(8，未确认99不计)');
  eq(st.totalCost, 5, 'D7 总成本=支出(5)+佣金(0)+税(0)+物流(0)');
  eq(st.totalReceipts, 30, 'D8 已收总额=30');
})();

/* =================== E. 调拨库存搬动 =================== */
(function () {
  const db = reset();
  const fromRec = S.stockRec('W1', 'G2', true);
  S.addLotQty(fromRec, { batchNo: 'TB1', productionDate: '2026-01-01', cost: 5 }, 20);
  S.addTransfer({ fromWhId: 'W1', toWhId: 'W2', goodsId: 'G2', batchNo: 'TB1', qty: 8, costPrice: 5, productionDate: '2026-01-01', shelfLife: 0, expiryDate: null, logisticsFee: 3, time: '2026-09-15' });
  const t = db.transfers[0];
  eq(t.status, '未生效', 'E1 新建调拨单=未生效');
  const err = S.activateTransfer(t.id);
  ok(err === null, 'E2 生效成功');
  eq(t.status, '已生效', 'E3 生效后=已生效');
  eq(S.stockRec('W1', 'G2', false).qty, 12, 'E4 发货仓 20-8=12');
  eq(S.stockRec('W2', 'G2', false).qty, 8, 'E5 收货仓 +8');
  eq(S.stockRec('W2', 'G2', false).lots[0].batchNo, 'TB1', 'E6 收货仓批次身份保留 TB1');
  eq(S.totalTransferLogisticsCost(), 3, 'E7 物流费计入成本=3');
  const rerr = S.reverseTransfer(t.id);
  ok(rerr === null, 'E8 撤销成功');
  eq(S.stockRec('W1', 'G2', false).qty, 20, 'E9 撤销后发货仓回补=20');
  eq(S.stockRec('W2', 'G2', false) ? S.stockRec('W2', 'G2', false).qty : 0, 0, 'E10 撤销后收货仓清零');
  // 同仓报错
  const te = S.addTransfer({ fromWhId: 'W1', toWhId: 'W1', goodsId: 'G2', batchNo: 'TB1', qty: 1, costPrice: 5, time: '2026-09-15' });
  eq(S.activateTransfer(te.id), '发货仓库与收货仓库不能相同', 'E11 同仓调拨拒绝');
})();

/* =================== F. 生产组装库存搬动 =================== */
(function () {
  const db = reset();
  const srcRec = S.stockRec('W1', 'G3', true);
  S.addLotQty(srcRec, { batchNo: 'PB1', productionDate: '2026-01-01', cost: 2 }, 10);
  S.addProduction({
    goodsName: '成品X', typeId: 1, unitId: 1, supplierId: null, sku: '',
    items: [{ whId: 'W1', goodsId: 'G3', goodsName: '原料B', unitId: 1, qty: 5, price: 2, amount: 10, batchNo: 'PB1', productionDate: '2026-01-01', shelfLife: 0, expiryDate: null }],
    laborFee: 0, qty: 3, costPrice: 5, amount: 15, retailPrice: 10, bigPrice: 9, wholesalePrice: 8,
    shelfLife: 0, expireWarn: 0, whId: 'W1', batchNo: 'SC-20260915-00001', time: '2026-09-15'
  });
  const p = db.productions[0];
  const err = S.completeProduction(p.id);
  ok(err === null, 'F1 生产完成成功');
  eq(p.status, '已完成', 'F2 状态=已完成');
  eq(S.stockRec('W1', 'G3', false).qty, 5, 'F3 原材料 10-5=5');
  const ng = db.goods.find(x => x.name === '成品X');
  ok(!!ng, 'F4 自动创建新成品商品');
  eq(S.stockRec('W1', ng.id, false).qty, 3, 'F5 成品入库=3');
  eq(S.stockRec('W1', ng.id, false).lots[0].batchNo, 'SC-20260915-00001', 'F6 成品批次(SC-)保留');
  S.deleteProduction(p.id);
  eq(S.stockRec('W1', 'G3', false).qty, 10, 'F7 删除后原材料回补=10');
  const prec = S.stockRec('W1', ng.id, false);
  ok(!prec || prec.qty === 0, 'F8 删除后成品批次移除');
})();

/* =================== G. 报损 / 报溢 =================== */
(function () {
  const db = reset();
  const lr = S.stockRec('W1', 'G4', true);
  S.addLotQty(lr, { batchNo: 'LB1', qty: 10, cost: 1 }, 10);
  S.addLoss({ whId: 'W1', goodsId: 'G4', qty: 4, price: 1, batchNo: 'LB1', typeId: 1, unitId: 1 });
  eq(S.stockRec('W1', 'G4', false).qty, 6, 'G1 报损后库存 10-4=6');
  eq(db.losses[0].amount, 4, 'G2 报损金额=数量×单价=4');
  S.deleteLoss(db.losses[0].id);
  eq(S.stockRec('W1', 'G4', false).qty, 10, 'G3 删除报损后库存回补=10');
  S.addOverflow({ whId: 'W1', goodsId: 'G4', qty: 3, price: 1, batchNo: null, typeId: 1, unitId: 1 });
  eq(S.stockRec('W1', 'G4', false).qty, 13, 'G4 报溢后库存 10+3=13');
  S.deleteOverflow(db.overflows[0].id);
  eq(S.stockRec('W1', 'G4', false).qty, 10, 'G5 删除报溢后库存回滚=10');
})();

/* ---------- B5 修改已完成销售单（业务闭环 / 有退货也允许改） ---------- */
(function B5_reviseFinishedSale() {
  reset();
  const db = S.db;
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'B1', productionDate: '2026-01-01', qty: 100, cost: 10 }, 100);
  db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '老客户' });
  const sale = { id: 'S1', no: 'SO-1', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 30, price: 15, amount: 450, lotKey: 'B1', alloc: [] }], total: 450, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
  db.sales.push(sale);
  ok(S.finishSale(sale) === null, 'B5-1 finishSale 成功');
  eq(S.stockQty('W1', 'G1'), 70, 'B5-2 完成后库存 70');
  ok(S.addReturn(sale, [{ itemIdx: 0, qty: 10 }]) === null, 'B5-3 退货成功');
  eq(S.stockQty('W1', 'G1'), 80, 'B5-4 退货后库存 80');
  const f1 = { customerId: 'C1', whId: 'W1', total: 750, taxRate: 0, taxExempt: '否', taxManual: false, deliveryFee: 0, incResourceCommission: '是', incRegionCommission: '是', items: [{ goodsId: 'G1', qty: 50, price: 15, _oidx: 0, lotKey: 'B1' }] };
  ok(S.reviseFinishedSale(sale, f1) === null, 'B5-5 修改成功');
  eq(S.stockQty('W1', 'G1'), 50, 'B5-6 修改后库存 50 (=100-50，已退10已计入)');
  eq(sale.status, '已完成', 'B5-7 状态仍为已完成');
  eq(sale.items[0].qty, 50, 'B5-8 数量更新为 50');
  eq(sale.items[0].alloc.reduce((a, b) => a + b.qty, 0), 50, 'B5-9 新 alloc 合计 50');
  const f2 = { customerId: 'C1', whId: 'W1', total: 0, taxRate: 0, taxExempt: '否', taxManual: false, deliveryFee: 0, incResourceCommission: '是', incRegionCommission: '是', items: [] };
  ok(/不能删除/.test(S.reviseFinishedSale(sale, f2) || ''), 'B5-10 删除已退货行被拒');
  const f3 = { customerId: 'C1', whId: 'W1', total: 0, taxRate: 0, taxExempt: '否', taxManual: false, deliveryFee: 0, incResourceCommission: '是', incRegionCommission: '是', items: [{ goodsId: 'G1', qty: 5, price: 15, _oidx: 0, lotKey: 'B1' }] };
  ok(/不能小于已退货/.test(S.reviseFinishedSale(sale, f3) || ''), 'B5-11 数量<已退货被拒');
  ok(S.stockQty('W1', 'G1') === 50, 'B5-12 两次失败用例未改动库存（仍为 50）');
})();

/* ---------- B5a 完成销售单超库存必须拦截（保存侧同口径由页面 save 校验） ---------- */
(function B5a_finishSaleStockGuard() {
  reset();
  const db = S.db;
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'B1', productionDate: '2026-01-01', qty: 10, cost: 10 }, 10);
  db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const sale = { id: 'SX', no: 'SO-X', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 25, price: 15, amount: 375, lotKey: 'B1', alloc: [] }], total: 375, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', saleTime: '2026-10-20 10:00', finishTime: '' };
  db.sales.push(sale);
  ok(/库存不足/.test(S.finishSale(sale) || ''), 'B5a-1 销售数量25>库存10, finishSale 拒绝');
  eq(sale.status, '未完成', 'B5a-2 拒绝后状态仍为未完成');
  eq(S.stockQty('W1', 'G1'), 10, 'B5a-3 库存未被扣减');
  sale.items[0].qty = 8; sale.items[0].amount = 120;
  ok(S.finishSale(sale) === null, 'B5a-4 改为8件后完成成功');
  eq(S.stockQty('W1', 'G1'), 2, 'B5a-5 完成后库存 10-8=2');
  eq(sale.saleTime, '2026-10-20 10:00', 'B5a-6 saleTime 字段保留');
  /* B5a-7 源码级回归：保存侧库存拦截必须用数组聚合（保留数字型 goodsId 原始类型）。
     genId() 是数字 id，若用对象键 for-in 聚合，键被转成字符串后 === 匹配
     stockQty/byId 全部失配 → 误报「库存 0 / 商品」（2026-10-21 线上事故）。 */
  const salesSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'pages', 'sales.js'), 'utf8');
  ok(salesSrc.indexOf('for (const gid in needMap)') === -1, 'B5a-7 保存侧拦截不得用对象键聚合（数字 id 会失配）');
  ok(salesSrc.indexOf('needList') > -1, 'B5a-8 保存侧拦截使用 needList 数组聚合');
})();

/* ---------- B7. 撤销已完成销售单（库存回补原批次 + 状态复位 + 守卫） ---------- */
(function B7_revokeSale() {
  reset();
  const db = S.db;
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'B1', productionDate: '2026-01-01', qty: 100, cost: 10 }, 100);
  db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const sale = { id: 'SR', no: 'SO-R', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 30, price: 15, amount: 450, lotKey: 'B1', alloc: [] }], total: 450, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
  db.sales.push(sale);
  ok(S.finishSale(sale) === null, 'B7-1 finishSale 成功');
  eq(S.stockQty('W1', 'G1'), 70, 'B7-2 完成后库存 70');
  eq(rec.lots.find(l => l.batchNo === 'B1').qty, 70, 'B7-3 批次 B1 余量 70');
  ok(sale.items[0].alloc && sale.items[0].alloc.length === 1 && sale.items[0].alloc[0].batchNo === 'B1', 'B7-4 alloc 记录原批次 B1');
  // 撤销 → 库存精确回补原批次
  ok(S.revokeSale(sale) === null, 'B7-5 revokeSale 成功');
  eq(S.stockQty('W1', 'G1'), 100, 'B7-6 撤销后库存回补=100');
  eq(rec.lots.find(l => l.batchNo === 'B1').qty, 100, 'B7-7 批次 B1 精确回补到 100');
  eq(sale.status, '未完成', 'B7-8 状态复位为未完成');
  eq(sale.finishTime, '', 'B7-9 finishTime 清空');
  eq(sale.payStatus, '', 'B7-10 payStatus 清空');
  ok(sale.items[0].alloc === null, 'B7-11 alloc 已清空');
  // 撤销后可删除（无孤儿数据）
  S.db.sales = S.db.sales.filter(x => x.id !== sale.id);
  eq(S.stockQty('W1', 'G1'), 100, 'B7-12 删除后库存不再变化(仍为100)');

  // 守卫：未完成不可撤销
  reset();
  const db2 = S.db;
  db2.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const sale2 = { id: 'S2', no: 'SO-2', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 5, lotKey: '', alloc: [] }], total: 0, status: '未完成', payStatus: '', createTime: 'T0', finishTime: '' };
  db2.sales.push(sale2);
  ok(/仅已完成/.test(S.revokeSale(sale2) || ''), 'B7-13 未完成单撤销被拒');

  // 守卫：已收款不可撤销
  reset();
  const db3 = S.db;
  const rec3 = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec3, { batchNo: 'B1', productionDate: '2026-01-01', qty: 100, cost: 10 }, 100);
  db3.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const sale3 = { id: 'S3', no: 'SO-3', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 10, lotKey: 'B1', alloc: [] }], total: 150, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
  db3.sales.push(sale3);
  S.finishSale(sale3);
  sale3.payStatus = '已支付';
  ok(/已收款/.test(S.revokeSale(sale3) || ''), 'B7-14 已收款单撤销被拒');
  eq(S.stockQty('W1', 'G1'), 90, 'B7-15 已收款单撤销被拒后库存未动(仍为90)');

  // 守卫：有退货记录不可撤销
  reset();
  const db4 = S.db;
  const rec4 = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec4, { batchNo: 'B1', productionDate: '2026-01-01', qty: 100, cost: 10 }, 100);
  db4.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const sale4 = { id: 'S4', no: 'SO-4', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 20, lotKey: 'B1', alloc: [] }], total: 300, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
  db4.sales.push(sale4);
  S.finishSale(sale4);
  ok(S.addReturn(sale4, [{ itemIdx: 0, qty: 5 }]) === null, 'B7-16 退货成功');
  ok(/退货记录/.test(S.revokeSale(sale4) || ''), 'B7-17 有退货记录撤销被拒');
  eq(S.stockQty('W1', 'G1'), 85, 'B7-18 有退货单撤销被拒后库存未动(仍为85)');
})();

/* ---------- B8. 销售单退货状态实时推导（不改存储 status） ---------- */
(function B8_saleDisplayStatus() {
  function buildFinished() {
    reset();
    const db = S.db;
    const rec = S.stockRec('W1', 'G1', true);
    S.addLotQty(rec, { batchNo: 'B1', productionDate: '2026-01-01', qty: 100, cost: 10 }, 100);
    db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
    const sale = { id: 'SR', no: 'SO-R', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 20, price: 15, amount: 300, lotKey: 'B1', alloc: [] }], total: 300, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
    db.sales.push(sale);
    ok(S.finishSale(sale) === null, 'B8-1 finishSale 成功');
    return sale;
  }
  // 未完成 → 显示未完成
  reset();
  const db0 = S.db;
  db0.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const s0 = { id: 'S0', no: 'SO-0', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 20, alloc: [] }], total: 300, status: '未完成', payStatus: '', createTime: 'T0', finishTime: '' };
  db0.sales.push(s0);
  eq(S.saleDisplayStatus(s0), '未完成', 'B8-2 未完成单显示未完成');

  // 已完成 + 无退货 → 已完成
  const s1 = buildFinished();
  eq(S.saleDisplayStatus(s1), '已完成', 'B8-3 已完成无退货显示已完成');
  eq(s1.status, '已完成', 'B8-4 存储 status 未被改动（仍为已完成）');

  // 已完成 + 部分退货（5/20）→ 部分退货
  const s2 = buildFinished();
  ok(S.addReturn(s2, [{ itemIdx: 0, qty: 5 }]) === null, 'B8-5 退货 5/20 成功');
  eq(S.saleDisplayStatus(s2), '部分退货', 'B8-6 部分退货显示部分退货');
  eq(s2.status, '已完成', 'B8-7 部分退货存储 status 仍为已完成（不被改写）');

  // 已完成 + 全部退货（20/20）→ 已退货
  const s3 = buildFinished();
  ok(S.addReturn(s3, [{ itemIdx: 0, qty: 20 }]) === null, 'B8-8 退货 20/20 成功');
  eq(S.saleDisplayStatus(s3), '已退货', 'B8-9 全部退货显示已退货');
  eq(s3.status, '已完成', 'B8-10 全部退货存储 status 仍为已完成（不被改写）');

  // 移除退货记录后实时恢复为已完成
  S.db.returns = S.db.returns.filter(r => r.saleId !== s3.id);
  eq(S.saleDisplayStatus(s3), '已完成', 'B8-11 移除退货记录后显示实时恢复为已完成');
})();

/* ---------- B6 客户自定义佣金比例 + 已支付单锁定 ---------- */
(function B6_customCommissionAndLock() {
  reset();
  const db = S.db;
  // 库存（供 finishSale 扣减）
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'B0', productionDate: '2026-01-01', cost: 10 }, 300);
  // 全局比例：资源一级 10%，区域(合伙人 P2) 5%
  db.resourceRates.push({ id: 1, level: 1, rate: 10, status: '已启用' });
  db.regionRates.push({ id: 1, partnerId: 'P2', rate: 5, status: '已启用' });
  // 客户：C1 用全局；C2 一级资源自定义 20%；C3 区域合伙人 P2
  db.customers.push(
    { id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', r1: 'P1', r2: null, r3: null, regionPartnerId: null, status: '已启用' },
    { id: 'C2', name: '客户2', taxRate: 0, taxExempt: '否', r1: 'P1', r2: null, r3: null, regionPartnerId: null, r1Rate: 20, status: '已启用' },
    { id: 'C3', name: '客户3', taxRate: 0, taxExempt: '否', regionPartnerId: 'P2', status: '已启用' }
  );
  function mkSale(id, custId) {
    const s = { id, no: 'SO-' + id, customerId: custId, whId: 'W1', items: [{ goodsId: 'G1', qty: 10, price: 10, amount: 100, lotKey: '', alloc: [] }], total: 100, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
    db.sales.push(s);
    return s;
  }
  const s1 = mkSale('S1', 'C1'), s2 = mkSale('S2', 'C2'), s3 = mkSale('S3', 'C3');
  ok(S.finishSale(s1) === null, 'B6-1 完成S1');
  ok(S.finishSale(s2) === null, 'B6-2 完成S2');
  ok(S.finishSale(s3) === null, 'B6-3 完成S3');
  let rc = S.resourceCommission(null, null).find(x => x.partnerId === 'P1' && x.level === 1);
  eq(rc.commission, 30, 'B6-4 P1一级佣金=10(C1全局)+20(C2自定义)=30');
  eq(rc.rate, 15, 'B6-5 等效混合比例=15%');
  let rg = S.regionCommission(null, null).find(x => x.partnerId === 'P2');
  eq(rg.commission, 5, 'B6-6 P2区域佣金=5(全局5%×100)');
  // 改 C2 自定义比例 → 未支付单应重算
  S.byId('customers', 'C2').r1Rate = 5;
  rc = S.resourceCommission(null, null).find(x => x.partnerId === 'P1' && x.level === 1);
  eq(rc.commission, 15, 'B6-7 C2改5%后 P1佣金=10+5=15（未支付单随比例重算）');
  // 支付 P1 金额 10 → 锁定 S1（整单10），S2 因余额不足暂不锁定
  const pay = S.addCommissionPay({ partnerId: 'P1', type: '资源', amount: 10, remark: 'test' });
  ok((pay.locked || []).includes('S1'), 'B6-8 支付10锁定S1');
  ok(!(pay.locked || []).includes('S2'), 'B6-9 S2未锁定（余额不足）');
  // 改全局一级比例到 50% → 已锁定 S1 不变，未锁定 S2 随新比例重算
  S.db.resourceRates[0].rate = 50;
  eq(S.saleCommissionFor(s1, 'P1', '资源'), 10, 'B6-10 已锁定S1佣金仍为10（不随比例变）');
  eq(S.saleCommissionFor(s2, 'P1', '资源'), 5, 'B6-11 未锁定S2随自定义比例=5%×100=5');
  rc = S.resourceCommission(null, null).find(x => x.partnerId === 'P1' && x.level === 1);
  eq(rc.commission, 15, 'B6-12 P1合计=锁定10+未锁定5=15');
  // compute-core 口径一致
  const CC = require(path.join(ROOT, 'js/compute-core.js'));
  const cc = CC.makeCompute(S.db);
  const ccr = cc.resourceCommission(null, null).find(x => x.partnerId === 'P1' && x.level === 1);
  eq(ccr.commission, rc.commission, 'B6-16 compute-core 与 store 口径一致(P1佣金=15)');
  eq(cc.saleCommissionFor(s3, 'P2', '区域'), 5, 'B6-17 compute-core 区域锁定一致(S3=5)');
  // 撤销支付 → 解锁，S1 恢复 live（按新比例50%=50）
  S.delCommissionPay(pay);
  eq(S.saleCommissionFor(s1, 'P1', '资源'), 50, 'B6-13 撤销支付后S1按新比例=50');
  // 区域同理
  const pay2 = S.addCommissionPay({ partnerId: 'P2', type: '区域', amount: 5, remark: 't' });
  eq(S.saleCommissionFor(s3, 'P2', '区域'), 5, 'B6-14 支付前S3区域=5');
  S.db.regionRates[0].rate = 20;
  eq(S.saleCommissionFor(s3, 'P2', '区域'), 5, 'B6-15 改全局区域比例后已锁定S3仍=5');
})();

/* =================== D2. 经销商级别自动评定 + 保级 =================== */
(function () {
  const db = reset();
  db.custTypes.push({ id: 1, name: '经销商', status: '已启用' });
  /* 档位：一级 30000+ / 二级 [15000,30000) / 三级 [5000,15000) / 四级 [1000,5000) / 五级 [0,1000) */
  const L = {};
  ['五级', '四级', '三级', '二级', '一级'].forEach((n, i) => {
    const lv = { id: 'DL' + i, name: n, status: '已启用' };
    if (i === 4) { lv.minAmount = 30000; lv.maxAmount = null; }
    else if (i === 3) { lv.minAmount = 15000; lv.maxAmount = 30000; }
    else if (i === 2) { lv.minAmount = 5000; lv.maxAmount = 15000; }
    else if (i === 1) { lv.minAmount = 1000; lv.maxAmount = 5000; }
    else { lv.minAmount = 0; lv.maxAmount = 1000; }
    db.dealerLevels.push(lv); L[n] = lv.id;
  });
  const now = U.today();
  db.customers.push({ id: 'C1', name: '经销商甲', typeId: 1, status: '已启用', dealerLevelId: null, dealerLevelBase: null, dealerLevelYear: null });
  db.sales.push({ id: 'S1', customerId: 'C1', status: '已完成', total: 20000, finishTime: now + ' 10:00:00', createTime: now + ' 09:00:00', items: [{ goodsId: 'G1', qty: 1, price: 20000, amount: 20000, alloc: [] }] });
  let n = S.evalDealerLevels(null);
  eq(S.byId('customers', 'C1').dealerLevelId, L['二级'], 'D2-1 当年采购20000 → 自动评二级');
  ok(n >= 1, 'D2-2 评定产生变更');

  /* 保级：手动调高到一级并模拟跨年（dealerLevelYear 置去年），新年度采购骤降 800 应保级为一级 */
  const c1 = S.byId('customers', 'C1');
  c1.dealerLevelId = L['一级'];
  c1.dealerLevelYear = new Date().getFullYear() - 1;
  const y = new Date().getFullYear();
  db.sales = db.sales.filter(s => s.id !== 'S1');
  db.sales.push({ id: 'S2', customerId: 'C1', status: '已完成', total: 800, finishTime: y + '-06-01 10:00:00', createTime: y + '-06-01 09:00:00', items: [{ goodsId: 'G1', qty: 1, price: 800, amount: 800, alloc: [] }] });
  S.evalDealerLevels(null);
  eq(S.byId('customers', 'C1').dealerLevelId, L['一级'], 'D2-3 跨年采购骤降仍保级=一级（不掉级）');
  eq(S.byId('customers', 'C1').dealerLevelBase, L['一级'], 'D2-4 保底=一级');

  /* 晋升：采购 40000 → 命中一级（与保底一致） */
  db.sales = db.sales.filter(s => s.id !== 'S2');
  db.sales.push({ id: 'S3', customerId: 'C1', status: '已完成', total: 40000, finishTime: y + '-08-01 10:00:00', createTime: y + '-08-01 09:00:00', items: [{ goodsId: 'G1', qty: 1, price: 40000, amount: 40000, alloc: [] }] });
  S.evalDealerLevels(null);
  eq(S.byId('customers', 'C1').dealerLevelId, L['一级'], 'D2-5 采购40000 命中一级（与保底一致）');

  /* compute-core 镜像一致性 */
  const CC = require(path.join(ROOT, 'js/compute-core.js'));
  const cc = CC.makeCompute(S.db);
  cc.evalDealerLevels(null);
  eq(cc.byId('customers', 'C1').dealerLevelId, S.byId('customers', 'C1').dealerLevelId, 'D2-6 compute-core 与 store 口径一致');
})();

/* ---------- R1. 推荐人绑定合伙人，已发奖励自动从佣金扣减（可支付可为负） ---------- */
(function R1_recommenderBindDeduct() {
  reset();
  const db = S.db;
  // 资源合伙人 P1 应得佣金 100（一级 10% × 销售净额 1000）
  const rec = S.stockRec('W1', 'G1', true);
  S.addLotQty(rec, { batchNo: 'BR1', productionDate: '2026-01-01', cost: 10 }, 100);
  db.resourceRates.push({ id: 1, level: 1, rate: 10, status: '已启用' });
  db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', r1: 'P1', r2: null, r3: null, regionPartnerId: null, status: '已启用' });
  const s1 = { id: 'S1', no: 'SO-1', customerId: 'C1', whId: 'W1', items: [{ goodsId: 'G1', qty: 10, price: 100, amount: 1000, lotKey: '', alloc: [] }], total: 1000, status: '未完成', payStatus: '', payTime: '', createTime: 'T0', finishTime: '' };
  db.sales.push(s1);
  ok(S.finishSale(s1) === null, 'R1-1 完成销售S1');
  eq(S.resourceCommission(null, null).find(x => x.partnerId === 'P1' && x.level === 1).commission, 100, 'R1-2 P1应得佣金=100');

  // 推荐人张三：已发放奖励 150（实付150）
  db.personRefs.push({ id: 'PR1', recommender: '张三', phone: '', refCustomerId: 'C1', reward: 150, paidAmount: 150, status: '已发放', createTime: '2026-09-01' });
  const rb = S.bindRecommender('P1', '资源', '张三');
  ok(rb.ok, 'R1-3 绑定推荐人张三→P1 成功');
  eq(S.refDeduct('P1', '资源'), 150, 'R1-4 已发放150 → 扣款150');

  // 未发放不扣
  db.personRefs.push({ id: 'PR2', recommender: '张三', phone: '', refCustomerId: 'C1', reward: 200, paidAmount: 0, status: '未发放', createTime: '2026-09-02' });
  eq(S.refDeduct('P1', '资源'), 150, 'R1-5 未发放200不计入扣款（仍150）');

  // 账户：应得 - 已付 - 质押 - 扣款 = 可支付（扣款后可为负，不封顶）
  const acc = S.partnerCommissionAccount('P1', '资源');
  eq(acc.earned, 100, 'R1-6 应得=100（佣金）');
  eq(acc.refDeduct, 150, 'R1-7 推荐扣款=150');
  eq(acc.payable, U.round2(acc.earned - acc.paid - acc.pledge - acc.refDeduct), 'R1-8 可支付=应得-已付-质押-扣款（公式闭环）');
  ok(acc.payable < 0, 'R1-8b 可支付为负（扣款超过应得，照实显示不封顶）');

  // 明细
  const det = S.refDeductDetail('P1', '资源');
  eq(det.length, 1, 'R1-9 扣款明细1个推荐人');
  eq(det[0].items.length, 1, 'R1-10 明细1笔已发放');

  // 解绑后不再扣（已扣部分不追溯返还）
  S.unbindRecommender(det[0].bindId);
  eq(S.refDeduct('P1', '资源'), 0, 'R1-11 解绑后扣款归零');

  // compute-core 镜像一致
  const CC = require(path.join(ROOT, 'js/compute-core.js'));
  let cc = CC.makeCompute(S.db);
  eq(cc.refDeduct('P1', '资源'), 0, 'R1-12 compute-core 解绑后一致=0');
  S.bindRecommender('P1', '资源', '张三');
  cc = CC.makeCompute(S.db);
  eq(cc.refDeduct('P1', '资源'), 150, 'R1-13 compute-core 重新绑定后=150');
  const cacc = cc.partnerCommissionAccount('P1', '资源');
  eq(cacc.payable, U.round2(cacc.earned - cacc.paid - cacc.pledge - cacc.refDeduct), 'R1-14 compute-core 可支付公式与 store 一致');
  ok(cacc.payable < 0, 'R1-14b compute-core 可支付同样为负（一致）');
})();

/* =================== S. 资金余额（按支付方式） =================== */
(function () {
  const db = reset();
  db.settings.openingFlags = Object.assign({}, db.settings.openingFlags, { funds: true });
  // 期初资金
  db.openingFunds.push({ payMethod: '微信', amount: 1000 }, { payMethod: '对公', amount: 5000 });
  // 注资
  db.capitalInjections.push({ method: '微信', amount: 500 }, { method: '银行卡', amount: 2000 });
  // 销售收款（已支付）
  db.sales.push(
    { status: '已完成', payStatus: '已支付', payMethod: '微信', actualPaid: 300 },
    { status: '已完成', payStatus: '已支付', payMethod: '对公', actualPaid: 1000 },
    { status: '已完成', payStatus: '未支付', payMethod: '微信', actualPaid: 0 } // 未支付不计
  );
  // 采购付款
  db.purchases.push({ payMethod: '微信', amount: 200 }, { payMethod: '银行卡', amount: 800 });
  // 运营支出（仅已计算计入）
  db.expenses.push({ status: '已计算', payMethod: '微信', amount: 100 });
  db.expenses.push({ status: '已计算', payMethod: '对公', amount: 300 });
  db.expenses.push({ status: '未计算', payMethod: '微信', amount: 999 }); // 未计算不计
  // 其他收入（仅已确认计入）
  db.incomes.push({ status: '已确认', payMethod: '微信', amount: 50 });
  db.incomes.push({ status: '未确认', payMethod: '对公', amount: 999 }); // 未确认不计

  const fb = S.fundBalanceByMethod();
  const byM = Object.fromEntries(fb.map(x => [x.method, x.balance]));
  eq(byM['微信'], U.round2(1000 + 500 + 300 + 50 - 200 - 100), 'S1 微信余额=期初+注资+收款+收入-采购-支出');
  eq(byM['对公'], U.round2(5000 + 1000 - 300), 'S2 对公余额=期初+收款-支出');
  eq(byM['银行卡'], U.round2(2000 - 800), 'S3 银行卡余额=注资-采购');
  ok(!('未设置' in byM), 'S4 无空支付方式流水，不出现「未设置」分组');
  eq(S.totalFundBalance(), U.round2(byM['微信'] + byM['对公'] + byM['银行卡']), 'S5 总余额=各方式之和');

  // compute-core 镜像一致
  const CC = require(path.join(ROOT, 'js/compute-core.js'));
  const cc = CC.makeCompute(S.db);
  const cfb = cc.fundBalanceByMethod();
  const cbyM = Object.fromEntries(cfb.map(x => [x.method, x.balance]));
  eq(cbyM['微信'], byM['微信'], 'S6 compute-core 微信余额与 store 一致');
  eq(cbyM['对公'], byM['对公'], 'S7 compute-core 对公余额与 store 一致');
  eq(cbyM['银行卡'], byM['银行卡'], 'S8 compute-core 银行卡余额与 store 一致');
})();

/* =================== M. 客户备忘 =================== */
(function () {
  const db = reset();
  db.customers.push({ id: 'C1', name: '测试客户A' }, { id: 'C2', name: '测试客户B' });
  const m1 = S.addMemo({ customerId: 'C1', content: '首次回访', memoTime: '2026-10-01', remindTime: '', status: '未解决' });
  ok(!!m1.id, 'M1 addMemo 生成 id');
  eq(m1.customerName, '测试客户A', 'M2 自动带出客户名称');
  eq(m1.status, '未解决', 'M3 默认状态=未解决');
  eq(m1.remindTime, '', 'M4 默认不提醒(空=禁用)');
  S.addMemo({ customerId: 'C1', content: '二次回访', memoTime: '2026-10-05', status: '已解决' });
  S.addMemo({ customerId: 'C2', content: 'B客户事项', memoTime: '2026-10-03', status: '未解决' });
  eq(S.custMemoCount('C1'), 2, 'M5 C1 备忘计数=2');
  eq(S.custMemoCount('C2'), 1, 'M6 C2 备忘计数=1');
  // 排序：未解决优先，同状态按 memoTime 倒序
  const cms = S.custMemos('C1');
  eq(cms.length, 2, 'M7 custMemos 仅含 C1');
  eq(cms[0].status, '未解决', 'M8 未解决排前');
  eq(cms[1].status, '已解决', 'M9 已解决排后');
  // 修改
  const upd = S.updateMemo(m1.id, { content: '已修改为重要', status: '已解决' });
  eq(upd.content, '已修改为重要', 'M10 updateMemo 改内容');
  eq(upd.status, '已解决', 'M11 updateMemo 改状态');
  // 改客户 → 自动同步客户名
  const upd2 = S.updateMemo(m1.id, { customerId: 'C2' });
  eq(upd2.customerName, '测试客户B', 'M12 改客户自动同步客户名');
  eq(S.custMemoCount('C2'), 2, 'M13 C2 计数随迁移+1');
  // 删除
  S.delMemo(m1.id);
  eq(S.custMemoCount('C1'), 1, 'M14 删除后 C1 计数归位');
  eq(S.custMemoCount('C2'), 1, 'M15 删除后 C2 计数归位');
})();

/* =================== S2. 资金收支明细（按支付方式聚合 + runningBalance） =================== */
(function () {
  const db = reset();
  db.settings.openingFlags = Object.assign({}, db.settings.openingFlags, { funds: true });
  db.openingFunds.push({ payMethod: '微信', amount: 1000, date: '2026-01-01' });
  db.sales.push({ status: '已完成', payStatus: '已支付', customerId: 'C1', actualPaid: 300,
    payments: [{ method: '微信', amount: 300, time: '2026-02-01' }] });
  db.purchases.push({ payMethod: '微信', amount: 200, date: '2026-03-01' });
  db.incomes.push({ status: '已确认', payMethod: '微信', amount: 50, date: '2026-04-01' });
  db.expenses.push({ status: '已计算', payMethod: '微信', amount: 100, date: '2026-05-01' });

  const rows = S.fundMethodDetail('微信');
  eq(rows.length, 5, 'S2-1 微信共5笔(期初+销售+采购+收入+支出)');
  eq(rows[0].date, '2026-01-01', 'S2-2 首笔=期初资金(日期最早)');
  eq(rows[0].dir, '收', 'S2-3 期初为收');
  eq(rows[0].runningBalance, 1000, 'S2-4 首笔累计=1000');
  eq(rows[1].dir, '收', 'S2-5 销售收款为收');
  eq(rows[1].runningBalance, 1300, 'S2-6 累计=1000+300');
  eq(rows[2].dir, '支', 'S2-7 采购付款为支');
  eq(rows[2].runningBalance, 1100, 'S2-8 累计=1300-200');
  eq(rows[3].runningBalance, 1150, 'S2-9 收入后累计=1100+50');
  eq(rows[4].runningBalance, 1050, 'S2-10 支出后累计=1150-100');
  const sum = rows.reduce((a, r) => U.round2(a + r.amount), 0);
  eq(sum, 1050, 'S2-11 各笔金额合计=1050 与末笔累计一致');
})();

/* ---------- B9. 收款撤回后支付状态正确归位（syncPayStatus 不再读回残留 actualPaid） ---------- */
(function B9_syncPayStatus() {
  // 加载页面级组件（含结算列表的 syncPayStatus 逻辑）
  eval(fs.readFileSync(path.join(ROOT, 'js/pages/sales.js'), 'utf8') + ';global.__SettleList = SettleList;');
  const SL = global.__SettleList.methods;
  function mkSale(extra) {
    return Object.assign({
      id: 'SX', no: 'SO-X', customerId: 'C1', whId: 'W1', status: '已完成',
      total: 100, payMethod: '', payTime: '', payStatus: '', actualPaid: 0,
      payments: [], finishTime: 'T0', createTime: 'T0',
      items: [{ goodsId: 'G1', qty: 1, price: 100, amount: 100, alloc: [] }]
    }, extra);
  }
  // 场景1：收满 → 已结清，撤空 → 应回未支付（修复点：不得被镜像 actualPaid 复活）
  reset();
  S.db.customers.push({ id: 'C1', name: '客户1', taxRate: 0, taxExempt: '否', remark: '' });
  const s1 = mkSale({ payments: [{ method: '微信', amount: 100, fee: 0, time: 'T1', remark: '收' }], actualPaid: 100, payStatus: '已结清' });
  SL.syncPayStatus(s1);
  eq(s1.payStatus, '已结清', 'B9-1 收满显示已结清');
  eq(s1.actualPaid, 100, 'B9-2 镜像=100');
  s1.payments = [];                 // 模拟 undoAllPayments 撤空
  SL.syncPayStatus(s1);
  eq(s1.payStatus, '未支付', 'B9-3 撤空后正确回到未支付（未被镜像复活）');
  eq(s1.actualPaid, 0, 'B9-4 镜像同步清零');

  // 场景2：部分收 → 部分支付，撤回剩余 → 回未支付
  const s2 = mkSale({ payments: [{ method: '微信', amount: 40, fee: 0, time: 'T1' }], actualPaid: 40, payStatus: '部分支付' });
  SL.syncPayStatus(s2);
  eq(s2.payStatus, '部分支付', 'B9-5 部分收显示部分支付');
  s2.payments = [];
  SL.syncPayStatus(s2);
  eq(s2.payStatus, '未支付', 'B9-6 部分撤回后回未支付');

  // 场景3：老单兼容（无 payments 数组但有 actualPaid）→ 回落仍已结清
  const s3 = mkSale({ payments: undefined, actualPaid: 100, payStatus: '已结清' });
  SL.syncPayStatus(s3);
  eq(s3.payStatus, '已结清', 'B9-7 老单(无payments有actualPaid)回落仍已结清');
})();

/* ---------- B10. 采购删除/修改守卫：数字型 goodsId 不能误报「库存不足」（数字型 id 聚合铁律） ---------- */
(function B10_purchaseDeleteNumericId() {
  // 用数字型 goodsId 复现真实数据场景：旧版对象键聚合会把数字 id 转字符串，
  // stockRec 用 === 严格比对 → 永远查不到库存 → 误报「库存不足以回滚，无法删除」。
  reset();
  const GID = S.genId();        // 数字 id（模拟真实 genId 生成的商品）
  S.db.goods.push({ id: GID, name: '测试商品N', typeId: 1, unitId: 1, supplierId: null, status: '已启用' });
  const rec = S.stockRec('W1', GID, true);
  S.addLotQty(rec, { batchNo: 'PO-N1', productionDate: '2026-10-20', cost: 18 }, 100);
  eq(rec.qty, 100, 'B10-1 入库 100');

  // 删除：整单尚在库，应成功（修复前此处误报拦截）
  const p = S.addPurchase({ whId: 'W1', items: [{ goodsId: GID, qty: 100, price: 18, batchNo: 'PO-N1', productionDate: '2026-10-20' }] });
  eq(S.stockQty('W1', GID), 200, 'B10-2 采购后合计 200');
  const derr = S.deletePurchase(p.id);
  eq(derr, null, 'B10-3 数字 id 采购单删除成功（不再误报库存不足）');
  eq(S.stockQty('W1', GID), 100, 'B10-4 删除后回滚为 100');

  // 删除：库存不足（部分已售出）应仍正确拦截
  const p2 = S.addPurchase({ whId: 'W1', items: [{ goodsId: GID, qty: 100, price: 18, batchNo: 'PO-N2', productionDate: '2026-10-20' }] });
  const r2 = S.deletePurchase(p2.id); // 现库存 200，可删
  eq(r2, null, 'B10-5 第二条采购删除成功');
  // 把库存人为降到低于第三单数量，验证拦截
  const p3 = S.addPurchase({ whId: 'W1', items: [{ goodsId: GID, qty: 80, price: 18, batchNo: 'PO-N3', productionDate: '2026-10-20' }] });
  rec.qty = 50;              // 模拟已售出 150，仅剩 50 < 80
  rec.lots = rec.lots.filter(l => l.batchNo === 'PO-N3' ? l.qty > 50 : true);
  const r3 = S.deletePurchase(p3.id);
  ok(/库存不足以回滚/.test(r3 || ''), 'B10-6 真·库存不足仍正确拦截删除');

  // 修改：数字 id 守卫同样不得误报
  reset();
  const GID2 = S.genId();
  S.db.goods.push({ id: GID2, name: '测试商品M', typeId: 1, unitId: 1, supplierId: null, status: '已启用' });
  const rec2 = S.stockRec('W1', GID2, true);
  S.addLotQty(rec2, { batchNo: 'PO-M1', productionDate: '2026-10-20', cost: 10 }, 60);
  const pm = S.addPurchase({ whId: 'W1', items: [{ goodsId: GID2, qty: 60, price: 10, batchNo: 'PO-M1', productionDate: '2026-10-20' }] });
  const errMod = S.updatePurchase(pm.id, { whId: 'W1', inTime: '2026-10-20 10:00', remark: '', payMethod: '', items: [{ goodsId: GID2, qty: 60, price: 12, batchNo: 'PO-M1', productionDate: '2026-10-20' }] });
  eq(errMod, null, 'B10-7 数字 id 采购单修改守卫不误报（仅改价）');
})();

/* =================== B11. 生产组装批次号不复用 + 删除回滚守卫 =================== */
(function () {
  /* 1) genScBatch 扫描现存库存 lot：已删单但批次仍在库时序号不复用 */
  const db = reset();
  // 模拟一张已删除的生产单，其成品批次仍残留在库存里（用当天日期，避免跨天脆化）
  const rec = S.stockRec('W1', 'G3', true);
  S.addLotQty(rec, { batchNo: 'SC-' + (U.today() || '').replace(/-/g, '') + '-00006', productionDate: U.today(), cost: 2 }, 103);
  const b1 = S.genScBatch();
  ok(b1 === 'SC-' + (U.today() || '').replace(/-/g, '') + '-00007', 'B11-1 扫描 lot 后新批次号跳过残留 00006 → 00007（' + b1 + '）');
  // 没有残留时从 00001 起
  const db2 = reset();
  eq(S.genScBatch(), 'SC-' + (U.today() || '').replace(/-/g, '') + '-00001', 'B11-2 空库存时从 00001 起');

  /* 2) deleteProduction：已完成单删除 → 原材料回补 + 成品批次移除 */
  const db3 = reset();
  const srcRec = S.stockRec('W1', 'G3', true);
  S.addLotQty(srcRec, { batchNo: 'PBX', productionDate: '2026-01-01', cost: 2 }, 10);
  S.addProduction({
    goodsName: '成品Y', typeId: 1, unitId: 1, supplierId: null, sku: '',
    items: [{ whId: 'W1', goodsId: 'G3', goodsName: '原料B', unitId: 1, qty: 5, price: 2, amount: 10, batchNo: 'PBX', productionDate: '2026-01-01', shelfLife: 0, expiryDate: null }],
    laborFee: 0, qty: 3, costPrice: 5, amount: 15, retailPrice: 10, bigPrice: 9, wholesalePrice: 8,
    shelfLife: 0, expireWarn: 0, whId: 'W1', batchNo: 'SC-20261022-00099', time: '2026-10-22'
  });
  const py = db3.productions[0];
  S.completeProduction(py.id);
  eq(S.stockRec('W1', 'G3', false).qty, 5, 'B11-3 完成后原材料=5');
  const ny = db3.goods.find(x => x.name === '成品Y');
  eq(S.stockRec('W1', ny.id, false).qty, 3, 'B11-4 完成后成品=3');
  ok(S.deleteProduction(py.id) === null, 'B11-5 删除成功');
  eq(S.stockRec('W1', 'G3', false).qty, 10, 'B11-6 删除后原材料回补=10');
  const precY = S.stockRec('W1', ny.id, false);
  ok(!precY || precY.qty === 0, 'B11-7 删除后成品批次移除');

  /* 3) deleteProduction：本地非「已完成」但成品批次仍在库（完成态未同步）时仍须回滚，杜绝孤儿批次 */
  const db4 = reset();
  const srcRec2 = S.stockRec('W1', 'G3', true);
  S.addLotQty(srcRec2, { batchNo: 'PBZ', productionDate: '2026-01-01', cost: 2 }, 10);
  S.addProduction({
    goodsName: '成品Z', typeId: 1, unitId: 1, supplierId: null, sku: '',
    items: [{ whId: 'W1', goodsId: 'G3', goodsName: '原料B', unitId: 1, qty: 5, price: 2, amount: 10, batchNo: 'PBZ', productionDate: '2026-01-01', shelfLife: 0, expiryDate: null }],
    laborFee: 0, qty: 3, costPrice: 5, amount: 15, retailPrice: 10, bigPrice: 9, wholesalePrice: 8,
    shelfLife: 0, expireWarn: 0, whId: 'W1', batchNo: 'SC-20261022-00100', time: '2026-10-22'
  });
  const pz = db4.productions[0];
  S.completeProduction(pz.id);
  // 模拟完成态未同步到删除设备：把本地状态改回未完成（但成品批次仍在库）
  pz.status = '未完成';
  ok(S.deleteProduction(pz.id) === null, 'B11-8 本地非已完成仍删除成功');
  const nz = db4.goods.find(x => x.name === '成品Z');
  const precZ = nz ? S.stockRec('W1', nz.id, false) : null;
  ok(!precZ || precZ.qty === 0, 'B11-9 非已完成但成品在库 → 删除后成品批次仍被移除（无孤儿）');
  eq(S.stockRec('W1', 'G3', false).qty, 10, 'B11-10 非已完成但原材料在库 → 删除后回补=10（无孤儿）');
})();

/* ---------- 汇总 ---------- */
console.log(`\n业务单元测试：通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('\n失败项：\n' + fails.join('\n')); process.exit(1); }
else console.log('全部业务单测通过 ✅');
