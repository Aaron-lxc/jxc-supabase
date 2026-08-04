/* ============================================================================
 * run.js — 进销存定时推送主脚本（Node）
 *
 * 用法：
 *   node run.js resource [--dry]     资源合伙人月佣金（每月1号9点）
 *   node run.js region   [--dry]     区域合伙人月佣金（每月1号9点）
 *   node run.js arrears  [--dry]     日欠款预警（每天8点 → 对账人）
 *   node run.js stock    [--dry]     日库存预警（每天8点 → 库管）
 *   node run.js weekly   [--dry]     本周经营（周六15点 → 管理者）
 *   node run.js monthly  [--dry]     上月经营（每月1号15点 → 管理者）
 *
 * --dry：只计算并打印，不真正发企微（本地自测用）。
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildDB, makeCompute } = require('./compute-core');
const { sendMarkdown } = require('./wecom');

const DIR = __dirname;
const dry = process.argv.includes('--dry');
const report = process.argv[2];

/* ---------------- 配置 ---------------- */
function loadJSON(name) {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) { console.error(`缺少配置文件 ${name}（参考 ${name.replace('.json', '.example.json')}）`); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
const cfg = loadJSON('config.json');
const rec = loadJSON('recipients.json');

/* ---------------- 金额格式 ---------------- */
function money(n) { return '¥' + Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/* ---------------- 拉取 db ---------------- */
async function fetchDB() {
  const { supabaseUrl, supabaseServiceKey, workspaceId } = cfg;
  const all = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const u = `${supabaseUrl}/rest/v1/records?workspace_id=eq.${encodeURIComponent(workspaceId)}`
      + `&select=coll,rid,data&order=coll.asc,rid.asc&limit=${size}&offset=${from}`;
    const r = await fetch(u, { headers: { 'apikey': supabaseServiceKey, 'Authorization': 'Bearer ' + supabaseServiceKey } });
    if (!r.ok) throw new Error('Supabase 拉取失败：' + r.status + ' ' + (await r.text()));
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) break;
    all.push(...rows);
    if (rows.length < size) break;
  }
  return buildDB(all);
}

/* ---------------- 明细链接 token ---------------- */
function detailToken(type, pid, month) {
  const s = cfg.detailSecret || 'changeme';
  return crypto.createHmac('sha256', s).update(`${type}:${pid}:${month}`).digest('hex').slice(0, 16);
}
function detailLink(type, pid) {
  const month = new Date().toISOString().slice(0, 7);
  const t = detailToken(type, pid, month);
  return `${cfg.detailBaseUrl}?type=${type}&pid=${pid}&ws=${encodeURIComponent(cfg.workspaceId)}&t=${t}`;
}

/* ---------------- 各报表构建 ---------------- */
function buildResource() {
  const S = makeCompute(DB);
  const lines = [];
  (DB.resourcePartners || []).forEach(p => {
    const wx = (rec.resourcePartners || {})[p.name];
    if (!wx) { console.log(`[跳过] 资源合伙人「${p.name}」未配置企微接收人`); return; }
    const acc = S.partnerCommissionAccount(p.id, '资源');
    const custCount = S.partnerCustomerIds(p.id, '资源').length;
    const link = detailLink('resource', p.id);
    const md = [
      `# 资源合伙人佣金月报`,
      `**合伙人：** ${p.name}`,
      `> 累计总佣金(含质押)：${money(acc.earned)}`,
      `> 累计已支付佣金：${money(acc.paid)}`,
      `> 待支付佣金：${money(acc.payable)}`,
      `> 质押佣金：${money(acc.pledge)}`,
      `> 累计客户数：${custCount} 个`,
      `[查看明细](${link})`
    ].join('\n');
    lines.push({ wx, md, name: p.name });
  });
  return lines;
}

function buildRegion() {
  const S = makeCompute(DB);
  const lines = [];
  (DB.regionPartners || []).forEach(p => {
    const wx = (rec.regionPartners || {})[p.name];
    if (!wx) { console.log(`[跳过] 区域合伙人「${p.name}」未配置企微接收人`); return; }
    const acc = S.partnerCommissionAccount(p.id, '区域');
    const custCount = S.partnerCustomerIds(p.id, '区域').length;
    const link = detailLink('region', p.id);
    const md = [
      `# 区域合伙人佣金月报`,
      `**合伙人：** ${p.name}`,
      `> 累计总佣金(含质押)：${money(acc.earned)}`,
      `> 累计已支付佣金：${money(acc.paid)}`,
      `> 待支付佣金：${money(acc.payable)}`,
      `> 质押佣金：${money(acc.pledge)}`,
      `> 累计客户数：${custCount} 个`,
      `[查看明细](${link})`
    ].join('\n');
    lines.push({ wx, md, name: p.name });
  });
  return lines;
}

function buildArrears() {
  const S = makeCompute(DB);
  const alerts = S.payAlerts();
  if (!alerts.length) return [];
  const rows = alerts.slice(0, 40).map((a, i) => {
    return `${i + 1}. ${a.name}｜账期:${a.period}｜应付:${a.due}｜超期${a.days}天｜`
      + `超期未付:${money(a.amt)}｜累计未付:${money(a.total)}｜备注:${a.remark || '-'}`;
  });
  const md = [
    `# 欠款客户预警（每日 ${new Date().toISOString().slice(0, 10)}）`,
    `共 ${alerts.length} 个客户存在超期未支付`,
    '```',
    rows.join('\n'),
    '```'
  ].join('\n');
  return [{ wx: (rec.collectors || []).join('|'), md, name: '对账人' }];
}

function buildStock() {
  const S = makeCompute(DB);
  const alerts = S.stockAlerts();
  if (!alerts.length) return [];
  const rows = alerts.slice(0, 40).map((a, i) => {
    return `${i + 1}. ${a.name}｜库存:${a.qty}｜最低:${a.min}｜缺口:${Math.max(0, a.min - a.qty)}`;
  });
  const md = [
    `# 库存预警（每日 ${new Date().toISOString().slice(0, 10)}）`,
    `共 ${alerts.length} 个商品低于最低库存`,
    '```',
    rows.join('\n'),
    '```'
  ].join('\n');
  return [{ wx: (rec.stockManagers || []).join('|'), md, name: '库管' }];
}

function weekRange() {
  const now = new Date();
  const dow = now.getDay(); // 0=周日
  const mondayOffset = (dow === 0 ? -6 : 1 - dow);
  const d1 = new Date(now); d1.setDate(now.getDate() + mondayOffset);
  const f = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { d1: f(d1), d2: f(now) };
}
function monthRange(offset) {
  const now = new Date();
  let y = now.getFullYear(), m = now.getMonth() + 1 + offset;
  if (m <= 0) { m += 12; y -= 1; }
  const last = new Date(y, m, 0).getDate();
  const p = n => String(n).padStart(2, '0');
  return { d1: `${y}-${p(m)}-01`, d2: `${y}-${p(m)}-${p(last)}` };
}

function buildBiz(period) {
  const S = makeCompute(DB);
  const { d1, d2 } = period === 'week' ? weekRange() : monthRange(-1);
  const label = period === 'week' ? `本周（${d1} ~ ${d2}）` : `上月（${d1} ~ ${d2}）`;

  const st = S.stats();
  // 账户（期初资金 + 注资）
  const byMethod = {};
  (DB.openingFunds || []).forEach(f => { byMethod[f.payMethod || '现金'] = (byMethod[f.payMethod || '现金'] || 0) + Number(f.amount); });
  // 客户总欠款
  const arrears = (DB.customers || []).map(c => ({ name: c.name, amt: S.custArrears(c.id) })).filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt);
  // 各商品货值
  const goodsVal = {};
  (DB.stocks || []).forEach(s => {
    const g = S.byId('goods', s.goodsId); if (!g) return;
    goodsVal[g.name] = (goodsVal[g.name] || 0) + s.qty * g.retailPrice;
  });
  // 本周收款
  const receipts = (DB.sales || []).filter(s => s.payStatus === '已支付' && s.payTime && s.payTime.slice(0, 10) >= d1 && s.payTime.slice(0, 10) <= d2)
    .reduce((a, s) => a + (Number(s.actualPaid) || S.salePayable(s)), 0);
  // 本周支出
  const expenses = (DB.expenses || []).filter(x => x.status === '已计算' && ((x.time || x.createTime || '').slice(0, 10) >= d1 && (x.time || x.createTime || '').slice(0, 10) <= d2))
    .reduce((a, x) => a + Number(x.amount), 0);
  // 新增客户 / 合伙人 / 送货 / 流失
  const newCust = (DB.customers || []).filter(c => (c.createTime || '').slice(0, 10) >= d1 && (c.createTime || '').slice(0, 10) <= d2).length;
  const lostCust = (DB.customers || []).filter(c => c.status === '流失').length;
  const newRes = (DB.resourcePartners || []).filter(p => (p.createTime || '').slice(0, 10) >= d1 && (p.createTime || '').slice(0, 10) <= d2).length;
  const newReg = (DB.regionPartners || []).filter(p => (p.createTime || '').slice(0, 10) >= d1 && (p.createTime || '').slice(0, 10) <= d2).length;
  const deliveries = (DB.sales || []).filter(s => s.status === '已完成' && (s.finishTime || s.createTime || '').slice(0, 10) >= d1 && (s.finishTime || s.createTime || '').slice(0, 10) <= d2).length;

  const md = [
    `# 经营情况（${label}）`,
    `## 资产`,
    `> 账户总金额：${money(st.totalOpeningFunds + st.totalCapital)}（期初资金 ${money(st.totalOpeningFunds)} + 注资 ${money(st.totalCapital)}）`,
    `> 各收款方式：` + Object.entries(byMethod).map(([k, v]) => `${k} ${money(v)}`).join('，'),
    `> 客户总欠款：${money(arrears.reduce((a, x) => a + x.amt, 0))}（${arrears.length} 户）`,
    `> 库存货值：${money(st.invValue)}`,
    `## 运营`,
    `> 本期收款：${money(receipts)}`,
    `> 本期支出：${money(expenses)}`,
    `> 累计客户数：${st.custTotal}`,
    `> 新增客户：${newCust}｜流失客户：${lostCust}`,
    `> 新增资源合伙人：${newRes}｜新增区域合伙人：${newReg}`,
    `> 本期送货（有金额销售单）：${deliveries} 单`,
    `## 库存预警`,
    `> 低于最低库存商品：${S.stockAlerts().length} 个`
  ].join('\n');
  return [{ wx: (rec.managers || []).join('|'), md, name: '管理者' }];
}

/* ---------------- 执行 ---------------- */
let DB;
async function main() {
  console.log(`[run] 报表类型=${report} dry=${dry}`);
  DB = await fetchDB();
  console.log(`[run] 已加载数据：客户 ${(DB.customers || []).length} / 销售 ${(DB.sales || []).length} / 资源合伙人 ${(DB.resourcePartners || []).length} / 区域合伙人 ${(DB.regionPartners || []).length}`);

  let msgs = [];
  if (report === 'resource') msgs = buildResource();
  else if (report === 'region') msgs = buildRegion();
  else if (report === 'arrears') msgs = buildArrears();
  else if (report === 'stock') msgs = buildStock();
  else if (report === 'weekly') msgs = buildBiz('week');
  else if (report === 'monthly') msgs = buildBiz('month');
  else { console.error('未知报表类型：' + report); process.exit(1); }

  if (!msgs.length) { console.log('[run] 无接收人/无数据，结束'); return; }

  const { corpid, agentSecret, agentid } = cfg.wecom;
  for (const m of msgs) {
    console.log(`\n===== 发送对象：${m.name} (${m.wx}) =====`);
    console.log(m.md);
    if (dry) { console.log('[dry] 跳过实际发送'); continue; }
    if (!m.wx) { console.log('[跳过] 无接收人'); continue; }
    try {
      await sendMarkdown(corpid, agentSecret, agentid, m.wx, m.md);
      console.log('[ok] 已发送');
    } catch (e) {
      console.error('[失败]', e.message);
    }
  }
  console.log('\n[run] 完成');
}

main().catch(e => { console.error(e); process.exit(1); });
