// ============================================================================
// Supabase Edge Function: report-detail
// 作用：校验明细链接 token，按合伙人裁剪数据后返回（不暴露 Service Key / 全量数据）。
// 部署：supabase functions deploy report-detail --no-verify-jwt
// 环境变量（Supabase 自动注入，无需手动设）：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// 需手动设（deploy-detail.ps1 从 config.json 读取）：
//   DETAIL_SECRET
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function emptyDB() {
  return {
    meta: { id: 1, seq: {} },
    goodsTypes: [], units: [], suppliers: [], goods: [],
    custLevels: [], custTypes: [], regions: [], customers: [],
    resourcePartners: [], regionPartners: [],
    warehouses: [], purchases: [], stocks: [], stockChecks: [],
    sales: [], returns: [], expenseCats: [], expenses: [],
    complaintTypes: [], complaints: [],
    resourceRates: [], regionRates: [], commissionPayments: [],
    openingStocks: [], openingAr: [], openingAp: [], openingFunds: [], capitalInjections: [],
    settings: { company: '', feeRates: {} }
  };
}

function buildDB(rows: any[]) {
  const db = emptyDB();
  const SINGLE = ['meta', 'settings'];
  (rows || []).forEach((r: any) => {
    if (!r || !r.coll || !r.data) return;
    if (SINGLE.includes(r.coll)) { db[r.coll] = r.data; return; }
    if (!Array.isArray(db[r.coll])) db[r.coll] = [];
    db[r.coll].push(r.data);
  });
  return db;
}

function filterForPartner(db: any, type: string, pid: any) {
  const custIds = db.customers
    .filter((c: any) => type === '区域'
      ? c.regionPartnerId == pid
      : (c.r1 == pid || c.r2 == pid || c.r3 == pid))
    .map((c: any) => c.id);
  return {
    settings: db.settings,
    resourceRates: db.resourceRates,
    regionRates: db.regionRates,
    commissionPayments: db.commissionPayments.filter((p: any) => p.partnerId == pid && p.type == type),
    customers: db.customers.filter((c: any) => custIds.includes(c.id)),
    sales: db.sales.filter((s: any) => custIds.includes(s.customerId))
  };
}

async function hmac(secret: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const pid = url.searchParams.get('pid');
  const ws = url.searchParams.get('ws');
  const t = url.searchParams.get('t');

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (!type || !pid || !ws || !t) return new Response(JSON.stringify({ error: 'missing params' }), { status: 400, headers });

  const secret = Deno.env.get('DETAIL_SECRET') || '';
  const month = new Date().toISOString().slice(0, 7);
  const expect = await hmac(secret, `${type}:${pid}:${month}`);
  if (t !== expect) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: rows, error } = await sb.from('records').select('coll,rid,data').eq('workspace_id', ws);
  if (error) return new Response(JSON.stringify({ error: String(error.message) }), { status: 500, headers });

  const db = buildDB(rows as any[]);
  const partial = filterForPartner(db, type, pid);
  const partner = (type === '区域' ? db.regionPartners : db.resourcePartners).find((p: any) => p.id == pid) || null;
  return new Response(JSON.stringify({ partner, partial }), { headers });
});
