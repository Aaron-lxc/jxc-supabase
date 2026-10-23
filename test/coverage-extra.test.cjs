/* 覆盖补强测试：客户级别评定 + 佣金支付迁移分支
 * 复用 business.test.cjs 的浏览器环境 shim，直接加载 store.js 做断言。
 * 运行：node test/coverage-extra.test.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

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
eval(fs.readFileSync(path.join(ROOT, 'js/utils.js'), 'utf8'));
global.Sync = {
  COLLS: [], schedule() {}, push() { return Promise.resolve(); }, pushAll() { return Promise.resolve(); },
  loadAll() { return Promise.resolve({ db: null, empty: true }); }, start() {}, stop() {}, resetShadow() {}, wipeRemote() { return Promise.resolve(); }
};
global.Cloud = { state: { user: { name: 'Tester' } } };

eval(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'));
const S = global.S;
let _seq = 1;
S.genId = () => 'id' + (_seq++);
S.genNo = (p) => p + '-0001';
S.genCode = (p) => p + '-1';

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(`✗ ${msg}`); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }

function reset() {
  S.state.db = S.emptyDB();
  const db = S.db;
  db.goodsTypes.push({ id: 1, name: '日化' });
  db.units.push({ id: 1, name: '袋' });
  db.warehouses.push({ id: 'W1', name: '总仓' });
  db.goods.push({ id: 'G1', name: '洗洁精', purchasePrice: 10, retailPrice: 15, shelfLife: 30, expireWarn: 7 });
  return db;
}

/* ============ T1. 客户级别自动评定（含退货影响） ============ */
(function () {
  const db = reset();
  db.custLevels.push(
    { id: 'L1', name: '一级', status: '已启用', minAmount: 0, maxAmount: 1000 },
    { id: 'L2', name: '二级', status: '已启用', minAmount: 1000, maxAmount: '' }
  );
  db.customers.push({ id: 'C1', name: '客户甲', levelId: '' });
  const today = (U.today() || '2026-10-01').slice(0, 7); // YYYY-MM
  db.sales.push({ id: 'S1', customerId: 'C1', status: '已完成', total: 1200, finishTime: today + '-15' });

  let changed = S.evalCustomerLevels(['C1']);
  eq(db.customers[0].levelId, 'L2', 'T1a 月均1200≥1000 → 评二级');
  ok(changed >= 1, 'T1b 级别发生变更');

  // 该笔销售退货 300 → 净额 900 → 应降为一级
  db.returns.push({ id: 'R1', saleId: 'S1', customerId: 'C1', total: 300, items: [] });
  changed = S.evalCustomerLevels(['C1']);
  eq(db.customers[0].levelId, 'L1', 'T1c 退货后净额900<1000 → 降一级');

  // 再退货 300（超过净额下限仍按公式落档，不报错）
  db.returns.push({ id: 'R2', saleId: 'S1', customerId: 'C1', total: 300, items: [] });
  changed = S.evalCustomerLevels(['C1']);
  eq(db.customers[0].levelId, 'L1', 'T1d 多级退货仍稳定落一级');
})();

/* ============ T2. delCommissionPay 迁移分支（无 locked 字段 + 已迁移标记） ============ */
(function () {
  const db = reset();
  db.commissionPayments = [{ id: 'PAY1', partnerId: 'P', type: '资源', amount: 100 }];
  db.commissionLocks = [
    { partnerId: 'P', type: '资源', saleId: 'S1' },
    { partnerId: 'P', type: '资源', saleId: 'S2' },
    { partnerId: 'Q', type: '资源', saleId: 'S3' },
    { partnerId: 'P', type: '区域', saleId: 'S4' }
  ];
  db._migratedCommissionLock = true;

  // 删除一笔迁移产生的支付（无 locked 字段）
  S.delCommissionPay({ id: 'PAY1', partnerId: 'P', type: '资源' });

  ok(db.commissionLocks.filter(l => l.partnerId === 'P' && l.type === '资源').length === 0,
    'T2a 迁移支付删除后，P+资源 全部锁定被清除');
  ok(db.commissionLocks.some(l => l.partnerId === 'Q' && l.type === '资源'),
    'T2b 其他合伙人(Q)锁定保留');
  ok(db.commissionLocks.some(l => l.partnerId === 'P' && l.type === '区域'),
    'T2c 同合伙人其他类型(区域)锁定保留');
  eq(db.commissionLocks.length, 2, 'T2d 剩余锁定数=2');
})();

/* ============ T3. delCommissionPay 常规分支（带 locked 字段，仅解本单锁定） ============ */
(function () {
  const db = reset();
  db.commissionPayments = [{ id: 'PAY2', partnerId: 'P', type: '资源', amount: 100, locked: ['S1', 'S2'] }];
  db.commissionLocks = [
    { partnerId: 'P', type: '资源', saleId: 'S1' },
    { partnerId: 'P', type: '资源', saleId: 'S2' },
    { partnerId: 'P', type: '资源', saleId: 'S3' } // 未被本单锁定，应保留
  ];
  db._migratedCommissionLock = false;

  S.delCommissionPay({ id: 'PAY2', partnerId: 'P', type: '资源', locked: ['S1', 'S2'] });

  eq(db.commissionLocks.map(l => l.saleId), ['S3'], 'T3 仅解本单锁定的 S1/S2，S3 保留');
})();

console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('\n失败项：\n' + fails.join('\n')); process.exit(1); }
else console.log('✅ 覆盖补强测试全部通过');
