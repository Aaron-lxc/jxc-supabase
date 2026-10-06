/* 静态检查：所有页面/组件模板内 <tr>/<tbody>/<thead> 标签配平（防止单元格落到 v-for 行外）。
   模板提取用扫描器正确处理嵌套反引号（${} 插值内可有子模板）。 */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const files = new Set([path.join(root, 'js', 'components.js')]);
fs.readdirSync(path.join(root, 'js', 'pages')).forEach(f => { if (f.endsWith('.js')) files.add(path.join(root, 'js', 'pages', f)); });

/* 从 src[pos] 的反引号开始，返回匹配闭反引号的位置（处理 ${...} 嵌套） */
function matchBacktick(src, start) {
  let depth = 0;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i], prev = src[i - 1];
    if (ch === '$' && src[i + 1] === '{' && prev !== '\\') { depth++; i++; continue; }
    if (ch === '}' && depth > 0) { depth--; continue; }
    if (ch === '`' && depth === 0 && prev !== '\\') return i;
    if (ch === '`' && depth > 0) { /* 插值内子模板，跳过其内容 */ i = matchBacktick(src, i); }
  }
  return -1;
}

let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  let idx = 0;
  while ((idx = src.indexOf('template:', idx)) !== -1) {
    const bt = src.indexOf('`', idx);
    if (bt === -1) break;
    const end = matchBacktick(src, bt);
    if (end === -1) break;
    const t = src.slice(bt + 1, end);
    const open = (t.match(/<tr[\s>]/g) || []).length, close = (t.match(/<\/tr>/g) || []).length;
    const to = (t.match(/<tbody>/g) || []).length, tc = (t.match(/<\/tbody>/g) || []).length;
    const tho = (t.match(/<thead>/g) || []).length, thc = (t.match(/<\/thead>/g) || []).length;
    if (open !== close || to !== tc || tho !== thc) {
      bad++;
      console.log('IMBALANCE ' + f + ' @offset' + idx + ' tr:' + open + '/' + close + ' tbody:' + to + '/' + tc + ' thead:' + tho + '/' + thc);
    }
    idx = end;
  }
}
console.log(bad ? 'BAD=' + bad : 'ALL_TEMPLATES_BALANCED');
process.exit(bad ? 1 : 0);
