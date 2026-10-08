// 管理员一键彻底删除用户：删除 Auth 账号（级联 profiles / workspace_members）。
// 仅允许该账套 manager/owner 删除本账套成员；禁删自己、禁删 owner。
// 部署：supabase functions deploy delete-user --no-verify-jwt
// （前端带 Authorization: Bearer 头；函数内手动校验 JWT，故用 --no-verify-jwt）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const auth = req.headers.get('authorization') || '';
    const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!jwt) return json(401, { error: '未登录或登录已失效' }, corsHeaders);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // 1) 校验调用者身份
    const { data: u, error: ue } = await supabase.auth.getUser(jwt);
    if (ue || !u.user) return json(401, { error: '登录已失效，请重新登录' }, corsHeaders);
    const caller = u.user.id;

    const { ws_id, user_id } = await req.json();
    if (!ws_id || !user_id) return json(400, { error: '缺少参数' }, corsHeaders);
    if (caller === user_id) return json(400, { error: '不能删除自己' }, corsHeaders);

    // 2) 校验调用者是该账套的 manager/owner 且已启用
    const { data: me, error: meErr } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', ws_id)
      .eq('user_id', caller)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me || me.status !== '已启用' || !['owner', 'admin'].includes(me.role)) {
      return json(403, { error: '只有账套创建者或管理员可以删除用户' }, corsHeaders);
    }

    // 3) 校验目标用户属于本账套（防止越权删任意 Auth 账号）
    const { data: target, error: tErr } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', ws_id)
      .eq('user_id', user_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target) return json(404, { error: '该用户不属于本账套，无法删除' }, corsHeaders);
    if (target.role === 'owner') return json(403, { error: '不能删除账套创建者' }, corsHeaders);

    // 4) 删除 Auth 用户（级联删 profiles / workspace_members）
    const { error: delErr } = await supabase.auth.admin.deleteUser(user_id);
    if (delErr) return json(500, { error: '删除失败：' + delErr.message }, corsHeaders);

    return json(200, { ok: true }, corsHeaders);
  } catch (e) {
    return json(500, { error: String((e && e.message) || e) }, corsHeaders);
  }
});

function json(code: number, body: any, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status: code,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
