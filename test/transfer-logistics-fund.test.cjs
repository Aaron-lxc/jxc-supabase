/* 调拨物流费计入资金账：store 与 compute-core 镜像一致性测试
 * 运行：node test/transfer-logistics-fund.test.cjs
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
const cc = require(path.join(ROOT, 'js/compute-core.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push('✗ ' + msg); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }

/* ---- store 侧 ---- */
S.state.db = S.emptyDB();
const db1 = S.db;
db1.settings = { openingFlags: { stock: false, ar: false, ap: false, funds: false } }; // 隔离期初/采购/收支干扰，专测调拨物流费
db1.transfers.push({ id: 'T1', no: 'DB-0001', fromWhId: 'W1', toWhId: 'W2', time: '2026-10-24', status: '已生效', logisticsFee: 100, logisticsPayMethod: '微信', items: [] });
db1.transfers.push({ id: 'T2', no: 'DB-0002', fromWhId: 'W1', toWhId: 'W2', time: '2026-10-24', status: '未生效', logisticsFee: 200, logisticsPayMethod: '支付宝', items: [] });
const fb1 = S.fundBalanceByMethod();
const w1 = fb1.find(x => x.method === '微信');
ok(w1 && Math.abs(w1.balance + 100) < 0.001, '已生效调拨物流费(微信 100)应作为现金流出计入资金账');
ok(!fb1.some(x => x.method === '支付宝'), '未生效调拨物流费(支付宝 200)不应计入资金账');

/* ---- compute-core 镜像侧 ---- */
const db2 = cc.emptyDB();
db2.settings = { openingFlags: { stock: false, ar: false, ap: false, funds: false } };
db2.transfers.push({ id: 'T1', no: 'DB-0001', fromWhId: 'W1', toWhId: 'W2', time: '2026-10-24', status: '已生效', logisticsFee: 100, logisticsPayMethod: '微信', items: [] });
db2.transfers.push({ id: 'T2', no: 'DB-0002', fromWhId: 'W1', toWhId: 'W2', time: '2026-10-24', status: '未生效', logisticsFee: 200, logisticsPayMethod: '支付宝', items: [] });
const C = cc.makeCompute(db2);
const fb2 = C.fundBalanceByMethod();
const w2 = fb2.find(x => x.method === '微信');
ok(w2 && Math.abs(w2.balance + 100) < 0.001, 'compute-core 镜像：已生效调拨物流费(微信 100)应计入资金账');
eq(fb1.map(x => x.method).sort(), fb2.map(x => x.method).sort(), 'store 与 compute-core 资金账口径应一致(均仅含微信)');

console.log(`\n调拨物流费计入资金账测试：${pass} 通过，${fail} 失败`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
console.log('✅ 全部通过');
