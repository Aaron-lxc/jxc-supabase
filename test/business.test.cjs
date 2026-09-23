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
  'personPromos', 'regionAssessArchive', 'resourceRates', 'regionRates', 'commissionPayments',
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

/* ---------- 汇总 ---------- */
console.log(`\n业务单元测试：通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('\n失败项：\n' + fails.join('\n')); process.exit(1); }
else console.log('全部业务单测通过 ✅');
