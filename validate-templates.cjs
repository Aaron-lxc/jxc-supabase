/* 模板编译校验：在 vm 沙箱中加载全部前端脚本（除 app.js 的挂载），
   用随附的 vue.global.prod.js 中的 Vue.compile 编译每个组件的 template，
   捕获 node --check 无法发现的模板语法错误。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = 'E:/workbuddy/2026-07-30-18-56-47/jxc-supabase';

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }

/* ---- 沙箱环境 ---- */
const sandbox = {};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.console = console;
sandbox.setTimeout = setTimeout;
sandbox.clearTimeout = clearTimeout;
sandbox.setInterval = setInterval;
sandbox.clearInterval = clearInterval;
sandbox.TextEncoder = TextEncoder;
sandbox.TextDecoder = TextDecoder;
sandbox.Blob = class { constructor() {} };
sandbox.URL = { createObjectURL: () => 'blob:', revokeObjectURL() {} };
sandbox.localStorage = {
  _m: {}, getItem(k) { return this._m[k] ?? null; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }
};
sandbox.location = { href: 'http://localhost/', reload() {}, pathname: '/', search: '' };
sandbox.navigator = { user_agent: 'node', useragent: 'node' };

/* 纯 JS HTML 实体解码器：Vue(prod 构建)的 decodeEntities 依赖真实 DOM 的
   innerHTML/textContent 来还原实体；在 Node 沙箱中我们用 createElement
   返回的“智能元素”模拟该行为，否则含 & 的属性值（如 v-if="a && b"）会让
   decodeEntities 返回 undefined 并导致编译崩溃（与真实浏览器无关）。 */
const HTML_ENTITIES = {
  quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', copy: '©',
  reg: '®', deg: '°', plusmn: '±', times: '×', divide: '÷', middot: '·',
  amp81: '&', lt60: '<', gt62: '>', ensp: ' ', emsp: ' ', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', bull: '•', euro: '€',
  pound: '£', yen: '¥', sect: '§', para: '¶', trade: '™', acute: '´'
};
function decodeHtml(raw) {
  if (typeof raw !== 'string' || raw.indexOf('&') < 0) return raw;
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);?/g, (full, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : full;
    }
    const named = HTML_ENTITIES[ent];
    return named !== undefined ? named : full;
  });
}
function makeDecoderEl() {
  let _html = '';
  return {
    style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, click() {},
    get innerHTML() { return _html; },
    set innerHTML(v) { _html = String(v); },
    get textContent() { return decodeHtml(_html); },
    get children() {
      const m = _html.match(/^<div foo="([\s\S]*)">$/);
      const foo = m ? decodeHtml(m[1].replace(/&quot;/g, '"')) : '';
      return [{ getAttribute: () => foo }];
    }
  };
}
sandbox.document = {
  hidden: false,
  createElement: () => makeDecoderEl(),
  createElementNS: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  documentElement: { style: {} },
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {} }
};
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

const ctx = vm.createContext(sandbox);

/* ---- 加载真实 Vue（含编译器） ---- */
vm.runInContext(read('vendor/vue.global.prod.js'), ctx, { filename: 'vue.global.prod.js' });
if (typeof sandbox.Vue === 'undefined' && sandbox.window.Vue) sandbox.Vue = sandbox.window.Vue;
if (typeof sandbox.Vue === 'undefined') { console.error('未能在沙箱中获得 Vue'); process.exit(2); }
if (typeof sandbox.Vue.compile !== 'function') { console.error('Vue.compile 不可用（非完整构建？）'); process.exit(2); }

/* ---- 顺序加载业务脚本（跳过 app.js，因为会尝试挂载 DOM） ---- */
const files = [
  'js/utils.js', 'js/config.js', 'js/cloud.js', 'js/perm.js', 'js/sync.js',
  'js/store.js', 'js/demo-data.js', 'js/components.js',
  'js/pages/dashboard.js', 'js/pages/goods.js', 'js/pages/customers.js',
  'js/pages/partners.js', 'js/pages/warehouse.js', 'js/pages/purchase.js',
  'js/pages/production.js',
  'js/pages/inventory.js', 'js/pages/sales.js', 'js/pages/opening.js', 'js/pages/capital.js', 'js/pages/finance.js',
  'js/pages/complaint.js', 'js/pages/report.js', 'js/pages/commission.js',
  'js/pages/members.js', 'js/pages/settings.js',
  'js/pages/recipientmgr.js', 'js/pages/report-center.js'
];
for (const f of files) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.error('加载失败 ' + f + '：' + e.message); process.exit(1); }
}

/* ---- 编译每个组件的 template ---- */
const compile = sandbox.Vue.compile;
let failures = 0, checked = 0;
function tryCompile(name, tpl) {
  if (typeof tpl !== 'string' || !tpl.trim()) return;
  checked++;
  try { compile(tpl, { onError(e) { throw e; } }); }
  catch (e) { failures++; console.error('  ✗ ' + name + '：' + (e.message || e)); }
}

Object.entries(sandbox.AppComponents || {}).forEach(([n, c]) => tryCompile('AppComponents.' + n, c.template));
Object.entries(sandbox.Pages || {}).forEach(([n, c]) => tryCompile('Pages.' + n, c.template));

/* ---- 单独校验 app.js 的根模板 ---- */
const appSrc = read('js/app.js');
const m = appSrc.match(/template:\s*`([\s\S]*?)`/);
if (m) tryCompile('app.js(root)', m[1]);
else console.error('未能从 app.js 提取根模板');

console.log(`\n已校验 ${checked} 个模板，失败 ${failures} 个。`);
if (failures) process.exit(1);

/* ---- 业务逻辑断言 ---- */
let asserts = 0, failed = 0;
function ok(cond, msg) { asserts++; if (!cond) { failed++; console.error('  ✗ ' + msg); } }

/* 页面数量：18 业务模块页 + 账户管理 + 报表接收人 = 20 */
ok(Object.keys(sandbox.Pages || {}).length === 20, 'Pages 应有 20 个页面（18 模块 + members + recipientmgr）');
ok(!!sandbox.Pages['page-members'], '应存在 page-members 账户管理页');
ok(!!sandbox.Pages['page-recipientmgr'], '应存在 page-recipientmgr 报表接收人页');

/* 权限 / 菜单过滤 */
sandbox.Cloud.state.ws = { id: 'w1', role: 'owner', permissions: {}, name: '测试账套' };
ok(sandbox.P.menus().length === 20, 'owner 的菜单应为 18 模块 + 账户管理 + 报表接收人 = 20 项');
sandbox.Cloud.state.ws = { id: 'w2', role: 'member', permissions: sandbox.P.defaultPermissions() };
const mm = sandbox.P.menus();
console.log('  [debug] member menus =', mm.map(m => m.key).join(','), '| isManager=', sandbox.P.isManager());
ok(mm.length === 12, 'member 默认权限下菜单应为 12 项（含奖励管理，无财务/佣金/设置/账户管理）');
ok(!mm.some(m => m.key === 'finance' || m.key === 'commission' || m.key === 'settings'),
  'member 默认不应看到 财务/佣金/设置');
ok(sandbox.P.canEdit('goods') && !sandbox.P.canEdit('finance'), '默认权限：商品可编辑、财务不可编辑');
ok(sandbox.P.isManager() === false, 'member 不是管理员');

/* 归一化权限完整性 */
const norm = sandbox.P.normalize(sandbox.P.defaultPermissions());
ok(sandbox.P.MODULES.every(m => norm[m.key]), 'normalize 后每个模块都有权限值');

/* 空库结构完整 */
const edb = sandbox.S.emptyDB();
ok(sandbox.Sync.COLLS.every(c => Array.isArray(edb[c]) || edb[c] !== undefined), 'emptyDB 含全部集合');

/* 演示数据可构建 */
const demo = sandbox.Demo.build();
ok(demo && Array.isArray(demo.goods) && demo.goods.length > 0, 'Demo.build 返回含商品的库');
ok(Array.isArray(demo.sales) && demo.sales.length > 0, 'Demo.build 含销售单');

/* 编号生成（去中心化，格式正确） */
sandbox.S.state.db = sandbox.S.emptyDB();
sandbox.S._buildIds();
const no = sandbox.S.genNo('PO');
ok(/^PO-\d{8}-\d{5}$/.test(no), 'genNo 生成形如 PO-YYYYMMDD-00001 的单号：' + no);
const code = sandbox.S.genCode('GD');
ok(/^GD-\d{4}$/.test(code), 'genCode 生成形如 GD-0001 的编码：' + code);
const id1 = sandbox.S.genId(), id2 = sandbox.S.genId();
ok(id1 !== id2 && Number.isFinite(id1), 'genId 生成唯一数字 id');

/* 业务核心：销售应付 = 净额 + 税点成本 */
sandbox.S.state.db = demo;
sandbox.Cloud.state.user = { id: 'u', email: 'a@b.c', name: '测试' };
const firstSale = demo.sales.find(s => s.status === '已完成');
if (firstSale) {
  const net = sandbox.S.saleNet(firstSale);
  const pay = sandbox.S.salePayable(firstSale);
  ok(pay >= net, '已完成销售单 含税应付 ≥ 净额（税点计入应付）');
}

console.log(`逻辑断言 ${asserts} 项，失败 ${failed} 项。`);
process.exit(failed ? 1 : 0);
