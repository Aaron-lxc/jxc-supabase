// ============================================================================
// Supabase Edge Function: report-unread（报表中心未读红点）
// 作用：判断当前接收人在该账套是否有「未读报表」——
//   底层 records 的最新更新时间晚于该接收人上次查看报表的时间(last_read_at) 即为未读。
// 安全：用 service_role 读 records（绕过 RLS）；仅基于当前登录用户身份判断，不泄露他人数据。
// 部署：supabase functions deploy report-unread --no-verify-jwt
// 环境变量（Supabase 自动注入）：SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

  const ws = new URL(req.url).searchParams.get('ws');
  if (!ws) return new Response(JSON.stringify({ error: 'missing ws' }), { status: 400, headers });

  const { data: prof } = await sb
    .from('recipient_profiles').select('last_read_at')
    .eq('auth_uid', uid).eq('ws_id', ws).eq('status', '启用').maybeSingle();

  const { data: mx } = await sb
    .from('records').select('updated_at')
    .eq('workspace_id', ws).order('updated_at', { ascending: false }).limit(1);

  const lastUpdate = mx && mx[0] ? mx[0].updated_at : null;
  const lastRead = prof ? prof.last_read_at : null;
  const unread = !!(lastUpdate && (!lastRead || new Date(lastUpdate) > new Date(lastRead)));

  return new Response(JSON.stringify({ unread, lastReadAt: lastRead, lastUpdate }), { headers });
});
