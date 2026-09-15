/* 集合三处登记一致性校验：store.emptyDB / compute-core.emptyDB / sync.COLLS
 * 运行：node test/check-collections.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

global.window = global;
global.document = { createElement: () => ({ click() {} }), getElementById: () => ({ set innerHTML(v) {} }), head: { appendChild() {} }, body: { appendChild() {}, removeChild() {} } };
global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
global.alert = () => {};
global.Vue = { reactive: (o) => o, ref: (v) => ({ value: v }), computed: (f) => ({ get value() { return f(); } }) };
eval(fs.readFileSync(path.join(ROOT, 'js/utils.js'), 'utf8'));
global.Sync = { COLLS: [], schedule() {}, push() { return Promise.resolve(); }, pushAll() { return Promise.resolve(); }, loadAll() { return Promise.resolve({ db: null, empty: true }); }, start() {}, stop() {}, resetShadow() {}, wipeRemote() { return Promise.resolve(); } };
global.Cloud = { state: { user: { name: 't' } } };
global.Demo = undefined;
eval(fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8'));
const S = global.S;

const storeKeys = Object.keys(S.emptyDB()).filter(k => !['meta', 'settings'].includes(k)).sort();
const CC = require(path.join(ROOT, 'js/compute-core.js'));
const ccKeys = Object.keys(CC.emptyDB()).filter(k => !['meta', 'settings'].includes(k)).sort();
const syncSrc = fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8');
const m = syncSrc.match(/COLLS\s*[:=]\s*\[([\s\S]*?)\]/);
const syncKeys = (m ? m[1] : '').match(/'([^']+)'/g) || [];
const syncList = syncKeys.map(s => s.replace(/'/g, '')).sort();

const A = new Set(storeKeys), B = new Set(ccKeys), C = new Set(syncList);
const onlyStore = storeKeys.filter(k => !B.has(k) || !C.has(k));
const onlyCC = ccKeys.filter(k => !A.has(k) || !C.has(k));
const onlySync = syncList.filter(k => !A.has(k) || !B.has(k));

console.log('store.emptyDB 集合数:', storeKeys.length);
console.log('compute-core.emptyDB 集合数:', ccKeys.length);
console.log('sync.COLLS 集合数:', syncList.length);
let bad = 0;
if (onlyStore.length) { bad++; console.log('\n⚠ 仅在 store.emptyDB（compute-core 或 sync 漏登）:', onlyStore); }
if (onlyCC.length) { bad++; console.log('\n⚠ 仅在 compute-core.emptyDB（store 或 sync 漏登）:', onlyCC); }
if (onlySync.length) { bad++; console.log('\n⚠ 仅在 sync.COLLS（store 或 compute-core 漏登）:', onlySync); }
/* 反向检查：compute-core 比 store 多的集合（store 漏登，会导致 buildDB 不补该键） */
const ccExtra = ccKeys.filter(k => !A.has(k));
if (ccExtra.length) { bad++; console.log('\n⚠ compute-core 有但 store 无（store 漏登）:', ccExtra); }
const ccMissing = storeKeys.filter(k => !B.has(k));
if (ccMissing.length && !onlyStore.includes) { console.log('\n  说明: store 有但 compute-core 无（compute-core 为只读统计，不影响同步，但若含业务数据则统计缺失）:', ccMissing); }

if (bad === 0) console.log('\n✅ 集合三处登记完全一致（store / compute-core / sync 对齐）');
else { console.log('\n❌ 存在登记不一致，详见上方'); process.exit(1); }
