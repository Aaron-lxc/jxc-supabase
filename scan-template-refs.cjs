/* 模板标识符扫描（防白屏回归）

   背景：Vue 运行时编译的模板被编译成 `with (_ctx) { ... }`，并使用
   RuntimeCompiledPublicInstanceProxyHandlers —— 它的 has() 对任何不以 _ 开头、
   且不在 JS 全局白名单里的标识符都返回 true。结果是模板里写的 `Cloud.xxx`
   不会回退到 window.Cloud，而是取到 _ctx.Cloud === undefined，渲染即抛
   TypeError，整页白屏。

   因此：模板里出现的每个自由标识符，都必须来自
     组件自身 data / computed / methods / props / v-for 局部变量
     或 app.config.globalProperties 注入的名字。
   本脚本静态扫描并报出不满足者。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = __dirname;
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* ---- 沙箱加载业务脚本，拿到组件定义 ---- */
const sandbox = {};
Object.assign(sandbox, {
  globalThis: sandbox, window: sandbox, self: sandbox, console,
  setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, TextDecoder,
  Blob: class { }, URL: { createObjectURL: () => 'blob:', revokeObjectURL() { } },
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  location: { href: 'http://localhost/', reload() { }, pathname: '/', search: '' },
  navigator: {},
  document: {
    hidden: false,
    createElement: () => ({ style: {}, setAttribute() { }, appendChild() { }, addEventListener() { }, click() { } }),
    createElementNS: () => ({ style: {}, setAttribute() { }, appendChild() { } }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    documentElement: { style: {} }, addEventListener() { }, removeEventListener() { }, body: { appendChild() { } }
  }
});
sandbox.window.addEventListener = () => { };
sandbox.window.removeEventListener = () => { };
sandbox.window.matchMedia = () => ({ matches: false, addListener() { }, removeListener() { } });
sandbox.echarts = { init: () => ({ setOption() { }, resize() { }, dispose() { }, on() { } }), dispose() { } };

const ctx = vm.createContext(sandbox);
vm.runInContext(read('vendor/vue.global.prod.js'), ctx, { filename: 'vue.js' });

const files = [
  'js/utils.js', 'js/config.js', 'js/cloud.js', 'js/perm.js', 'js/sync.js',
  'js/store.js', 'js/demo-data.js', 'js/components.js',
  'js/pages/dashboard.js', 'js/pages/goods.js', 'js/pages/customers.js',
  'js/pages/partners.js', 'js/pages/warehouse.js', 'js/pages/purchase.js',
  'js/pages/inventory.js', 'js/pages/sales.js', 'js/pages/opening.js', 'js/pages/capital.js', 'js/pages/finance.js',
  'js/pages/complaint.js', 'js/pages/report.js', 'js/pages/commission.js',
  'js/pages/members.js', 'js/pages/settings.js'
];
files.forEach(f => vm.runInContext(read(f), ctx, { filename: f }));

sandbox.S.state.db = sandbox.Demo.build();
sandbox.S.state.ready = true;
sandbox.Cloud.state.ws = { id: 'w1', name: 'T', role: 'owner', permissions: {} };
sandbox.Cloud.state.user = { id: 'u1', email: 'a@b.c', name: 'T' };

/* app.js 通过 globalProperties 注入的名字（须与 app.js 保持一致） */
const GLOBAL_PROPS = (() => {
  const src = read('js/app.js');
  const m = src.match(/globalProperties,\s*\{([\s\S]*?)\}\);/);
  if (!m) return [];
  return [...m[1].matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].map(x => x[1]);
})();

const KEYWORDS = new Set([
  'true', 'false', 'null', 'undefined', 'in', 'of', 'new', 'typeof', 'instanceof',
  'void', 'delete', 'return', 'function', 'if', 'else', 'this', 'var', 'let', 'const',
  'do', 'while', 'for', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'throw'
]);
const JS_GLOBALS = new Set([
  'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
  'Error', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'console', 'Symbol',
  'Promise', 'Set', 'Map', 'BigInt', 'encodeURIComponent', 'decodeURIComponent'
]);

/* 取模板中所有会被当成 JS 表达式求值的片段 */
function expressions(tpl) {
  const out = [];
  let m;
  const mu = /\{\{([\s\S]*?)\}\}/g;
  while ((m = mu.exec(tpl))) out.push(m[1]);
  const attr = /(?:^|\s)(v-[a-zA-Z-]+(?::[a-zA-Z0-9_.-]+)?|[:@][a-zA-Z0-9_.:-]+)\s*=\s*"([^"]*)"/g;
  while ((m = attr.exec(tpl))) {
    const name = m[1];
    if (/^v-(else|pre|once|cloak)$/.test(name)) continue;
    out.push(m[2]);
  }
  return out;
}

/* v-for / v-slot 引入的局部变量（简化为整模板可见） */
function localVars(tpl) {
  const vars = new Set();
  let m;
  const vf = /v-for\s*=\s*"([^"]*)"/g;
  while ((m = vf.exec(tpl))) {
    const left = m[1].split(/\s+(?:in|of)\s+/)[0].trim().replace(/^\(|\)$/g, '');
    left.split(',').forEach(v => { v = v.trim(); if (v) vars.add(v); });
  }
  const vs = /v-slot(?::[a-zA-Z0-9_-]+)?\s*=\s*"([^"]*)"/g;
  while ((m = vs.exec(tpl))) {
    (m[1].match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []).forEach(v => vars.add(v));
  }
  return vars;
}

/* 从表达式中提取自由标识符（排除属性名、对象字面量 key、字符串内容） */
function identifiers(expr) {
  const s = expr
    .replace(/'(\\.|[^'\\])*'/g, "''")
    .replace(/"(\\.|[^"\\])*"/g, '""')
    .replace(/`(\\.|[^`\\])*`/g, '``');
  const ids = new Set();
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[1], start = m.index, end = re.lastIndex;
    /* 属性访问：前面是 . 或 ?. */
    const before = s.slice(0, start).replace(/\s+$/, '');
    if (/[.?]$/.test(before)) continue;
    /* 对象字面量 key：后面是 : 且前面是 { 或 , */
    const after = s.slice(end).replace(/^\s+/, '');
    if (after.startsWith(':') && !after.startsWith('::') && /[{,]$/.test(before)) continue;
    if (KEYWORDS.has(name) || JS_GLOBALS.has(name)) continue;
    if (name[0] === '$') continue;
    ids.add(name);
  }
  return ids;
}

function ownKeys(comp) {
  const keys = new Set();
  ['computed', 'methods'].forEach(sec => Object.keys(comp[sec] || {}).forEach(k => keys.add(k)));
  (Array.isArray(comp.props) ? comp.props : Object.keys(comp.props || {})).forEach(k => keys.add(k));
  Object.keys(comp.inject || {}).forEach(k => keys.add(k));
  if (typeof comp.data === 'function') {
    try { Object.keys(comp.data.call({ $props: {} }) || {}).forEach(k => keys.add(k)); }
    catch (e) { keys.add('__DATA_UNRESOLVED__'); }
  }
  return keys;
}

var problems = 0, scanned = 0;
function scan(name, comp, extraKnown) {
  const tpl = comp && comp.template;
  if (typeof tpl !== 'string' || !tpl.trim()) return;
  scanned++;
  const known = ownKeys(comp);
  (extraKnown || []).forEach(k => known.add(k));
  localVars(tpl).forEach(k => known.add(k));
  GLOBAL_PROPS.forEach(k => known.add(k));

  const bad = new Set();
  expressions(tpl).forEach(e => {
    /* 表达式内箭头函数的形参属于局部作用域 */
    const local = new Set();
    [...e.matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g)].forEach(m => local.add(m[1]));
    [...e.matchAll(/\(([^()]*)\)\s*=>/g)].forEach(m =>
      m[1].split(',').forEach(v => { v = v.trim(); if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(v)) local.add(v); }));
    identifiers(e).forEach(id => { if (!known.has(id) && !local.has(id)) bad.add(id); });
  });
  if (bad.size) {
    problems++;
    console.log('  ✗ ' + name + ' → 模板引用了实例上不存在的标识符: ' + [...bad].join(', '));
  }
}

/* 自检：确认扫描器确实能发现问题（防止检查器本身失效而假绿） */
(function selfTest() {
  let caught = 0;
  const orig = console.log;
  console.log = () => { };
  const before = problems;
  scan('__selftest__', {
    template: '<div v-if="NotInjected.state.list.length">{{ AlsoMissing.foo() }}</div>',
    computed: {}, methods: {}
  });
  console.log = orig;
  caught = problems - before;
  problems = before;   // 自检不计入真实问题数
  if (!caught) {
    console.error('扫描器自检失败：无法检出已知的未定义引用，检查结果不可信。');
    process.exit(2);
  }
  console.log('自检通过：扫描器可正确检出未定义引用。');
})();

console.log('=== globalProperties 注入: ' + GLOBAL_PROPS.join(', ') + ' ===');
Object.entries(sandbox.AppComponents || {}).forEach(([n, c]) => scan('AppComponents.' + n, c));
Object.entries(sandbox.Pages || {}).forEach(([n, c]) => scan('Pages.' + n, c));

/* app.js 根组件：从源码提取键名 */
const appSrc = read('js/app.js');
const rootTpl = (appSrc.match(/template:\s*`([\s\S]*?)`\s*\n\s*\}\)/) || appSrc.match(/template:\s*`([\s\S]*?)`/))[1];
const rootKeys = new Set();
/* methods / computed 名（缩进定义） */
[...appSrc.matchAll(/(?:^|\n)\s{6,8}(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*[:(]/g)].forEach(m => rootKeys.add(m[1]));
/* data() 返回对象里的键（可能多个写在同一行） */
const dataBlock = appSrc.match(/data\(\)\s*\{\s*return\s*\{([\s\S]*?)\n\s*\};/);
if (dataBlock) {
  [...dataBlock[1].matchAll(/([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g)].forEach(m => rootKeys.add(m[1]));
}
scan('app.js(root)', { template: rootTpl }, [...rootKeys]);

console.log(`\n已扫描 ${scanned} 个模板，发现问题 ${problems} 个。`);
process.exit(problems ? 1 : 0);
