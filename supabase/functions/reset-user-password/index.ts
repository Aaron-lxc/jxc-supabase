// 管理员为成员重置登录密码（service_role 直接改 Auth 用户密码，不依赖邮箱/邮件）。
// 仅允许该账套 owner/admin 为本账套成员重置；禁自改（自己请走系统设置改密码）、禁改 owner。
// 部署：supabase functions deploy reset-user-password --no-verify-jwt
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

    const { ws_id, user_id, new_password } = await req.json();
    if (!ws_id || !user_id || !new_password) return json(400, { error: '缺少参数' }, corsHeaders);
    if (typeof new_password !== 'string' || new_password.length < 6) {
      return json(400, { error: '新密码至少 6 位' }, corsHeaders);
    }
    if (caller === user_id) return json(400, { error: '不能在此重置自己的密码，请到系统设置修改' }, corsHeaders);

    // 2) 校验调用者是该账套的 owner/admin 且已启用
    const { data: me, error: meErr } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', ws_id)
      .eq('user_id', caller)
      .maybeSingle();
    if (meErr) throw meErr;
    if (!me || me.status !== '已启用' || !['owner', 'admin'].includes(me.role)) {
      return json(403, { error: '只有账套创建者或管理员可以重置成员密码' }, corsHeaders);
    }

    // 3) 校验目标用户属于本账套（防止越权改任意 Auth 账号密码）
    const { data: target, error: tErr } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', ws_id)
      .eq('user_id', user_id)
      .maybeSingle();
    if (tErr) throw tErr;
    if (!target) return json(404, { error: '该用户不属于本账套，无法重置密码' }, corsHeaders);
    if (target.role === 'owner') return json(403, { error: '不能重置账套创建者的密码' }, corsHeaders);

    // 4) 重置密码（service_role 直接改 Auth 用户，原密码立即失效，不发邮件）
    const { error: upErr } = await supabase.auth.admin.updateUserById(user_id, { password: new_password });
    if (upErr) return json(500, { error: '重置失败：' + upErr.message }, corsHeaders);

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
