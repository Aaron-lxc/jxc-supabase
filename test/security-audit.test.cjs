/* 安全回归测试：集合 → 权限模块映射完整性
 *
 * 守护项目铁律：「集合写入权限收口」——sql/schema.sql 的 public.coll_module(c)
 * 必须把每个业务集合映射到正确的权限模块键，遗漏会落入 else '__shared__'，
 * 被 has_any_edit（任一模块可编辑即可写）放行，造成越权写高危。
 *
 * 本测试直接解析 schema.sql 与 sync.js，断言：
 *   1) sync.COLLS / SINGLETONS 中的集合，除刻意共享的 allowShared 外，
 *      必须被 coll_module 显式映射，且映射结果 ≠ '__shared__'；
 *   2) 刻意共享集合（meta / settings）必须确为 '__shared__'（核对意图未漂移到其他模块）；
 *   3) 不允许任何业务集合静默落到 else '__shared__'。
 *
 * 运行：node test/security-audit.test.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(`✗ ${msg}`); } }
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), `${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }

/* ---------- 解析 schema.sql 的 coll_module ---------- */
const sql = fs.readFileSync(path.join(ROOT, 'sql/schema.sql'), 'utf8');
const fnStart = sql.indexOf('create or replace function public.coll_module');
const fnEnd = sql.indexOf('$$;', fnStart);
const fnBlock = sql.slice(fnStart, fnEnd);

const mapped = {};
let m, re = /when\s+'([^']+)'\s+then\s+'([^']+)'/g;
while ((m = re.exec(fnBlock)) !== null) mapped[m[1]] = m[2];
const elseMatch = fnBlock.match(/else\s+'([^']+)'/);
const elseVal = elseMatch ? elseMatch[1] : null;

/* ---------- 解析 sync.js 的 COLLS / SINGLETONS ---------- */
const sync = fs.readFileSync(path.join(ROOT, 'js/sync.js'), 'utf8');
function parseArray(name) {
  const i = sync.indexOf(`${name}: [`);
  const start = sync.indexOf('[', i);
  let depth = 0, j = start;
  for (; j < sync.length; j++) {
    if (sync[j] === '[') depth++;
    else if (sync[j] === ']') { depth--; if (depth === 0) break; }
  }
  const body = sync.slice(start + 1, j);
  return (body.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
}
const COLLS = parseArray('COLLS');
const SINGLETONS = parseArray('SINGLETONS');

/* ---------- 断言 ---------- */
const allowShared = new Set(['meta', 'settings']); // 刻意共享（单号计数器 / 系统设置）
const allColls = Array.from(new Set([...COLLS, ...SINGLETONS]));

ok(elseVal === '__shared__', `coll_module 的 else 分支应为 '__shared__'（实际 ${elseVal}）`);

let unmapped = [];
for (const c of allColls) {
  const eff = Object.prototype.hasOwnProperty.call(mapped, c) ? mapped[c] : elseVal; // 显式映射或 else 兜底
  if (allowShared.has(c)) {
    eq(eff, '__shared__', `刻意共享集合 ${c} 应解析为 '__shared__'（实际 ${eff}）`);
  } else {
    if (!(c in mapped)) { unmapped.push(c); ok(false, `集合 ${c} 未在 coll_module 中显式映射（将静默落入 '__shared__'，越权写高危）`); }
    else if (mapped[c] === '__shared__') { unmapped.push(c); ok(false, `集合 ${c} 被映射为 '__shared__'，非刻意共享集合不得落入共享（越权写高危）`); }
    else ok(true, `集合 ${c} → 模块 '${mapped[c]}' ✓`);
  }
}

ok(unmapped.length === 0, `所有业务集合均已正确映射（未映射/误共享：${unmapped.length ? unmapped.join(', ') : '无'}）`);

/* memos 专项：客户备忘，必须归入 customers 模块 */
ok(mapped['memos'] === 'customers', `memos 必须映射到 'customers' 模块（实际 ${mapped['memos']}）`);

/* ---------- 汇总 ---------- */
console.log('\n========== 安全审计：集合权限映射 ==========');
console.log(`COLLS(${COLLS.length}) + SINGLETONS(${SINGLETONS.length}) 共 ${allColls.length} 个集合`);
console.log(`coll_module 显式映射 ${Object.keys(mapped).length} 个，else='${elseVal}'`);
console.log('刻意共享（允许 __shared__）：', [...allowShared].join(', '));
if (unmapped.length) console.log('⚠ 未正确映射：', unmapped.join(', '));
console.log('memos →', mapped['memos']);
console.log('============================================');
console.log(`\n通过 ${pass}，失败 ${fail}`);
if (fail) { console.log('\n失败项：\n' + fails.join('\n')); process.exit(1); }
else console.log('✅ 集合权限映射完整性校验通过');
