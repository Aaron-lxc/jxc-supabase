// ============================================================================
// Supabase Edge Function: report-detail（报表中心版）
// 作用：接收人登录后，按 recipient_profiles 的角色返回其专属报表。
//   - 合伙人(resource/region)：服务端按合伙人裁剪 customers/sales 后返回
//     （客户端用 ComputeCore 算佣金，拿不到其他合伙人的数据）
//   - 仅支持合伙人(resource/region)；对账人/库管/管理者三种报表角色已从系统移除，
//     else 分支仅作为历史数据清理前的安全兜底，返回完整 db。
// 安全：用 service_role 读 records（绕过 RLS）；报表成员(role='报表')在 RLS 层被禁止直读原始数据。
// 部署：supabase functions deploy report-detail --no-verify-jwt
// 环境变量（Supabase 自动注入）：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
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

Deno.serve(async (req) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });

  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: u, error: ue } = await sb.auth.getUser(jwt);
  if (ue || !u.user) return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  const uid = u.user.id;

  const url = new URL(req.url);
  const ws = url.searchParams.get('ws');
  if (!ws) return new Response(JSON.stringify({ error: 'missing ws' }), { status: 400, headers });

  const { data: prof, error: pe } = await sb
    .from('recipient_profiles').select('*')
    .eq('auth_uid', uid).eq('ws_id', ws).eq('status', '启用').maybeSingle();
  if (pe || !prof) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers });

  // 标记已读：打开报表即视为已查看，清除未读红点（last_read_at 用于 report-unread 比较）
  await sb.from('recipient_profiles').update({ last_read_at: new Date().toISOString() }).eq('id', prof.id).catch(() => {});

  const { data: rows, error } = await sb.from('records').select('coll,rid,data').eq('workspace_id', ws);
  if (error) return new Response(JSON.stringify({ error: String(error.message) }), { status: 500, headers });
  const db = buildDB(rows as any[]);

  if (prof.role === 'resource' || prof.role === 'region') {
    const type = prof.role === 'region' ? '区域' : '资源';
    const pid = prof.partner_id;
    if (!pid) return new Response(JSON.stringify({ error: 'profile missing partner_id' }), { status: 400, headers });
    const partial = filterForPartner(db, type, pid);
    const partner = (type === '区域' ? db.regionPartners : db.resourcePartners).find((p: any) => p.id == pid) || null;
    return new Response(JSON.stringify({ role: prof.role, type, partner, partial }), { headers });
  }

  // 安全兜底：正常只会是 resource/region；其余情况按完整 db 返回（历史数据清理前兼容）
  return new Response(JSON.stringify({ role: prof.role, db }), { headers });
});
