// 受邀注册通道：关闭 Supabase 公开注册后，仅被邀请的邮箱可注册。
// 部署：supabase functions deploy invite-signup --no-verify-jwt
// （必须 --no-verify-jwt，因为未登录用户也要能调用）
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { email, password, name } = await req.json();
    if (!email || !password) {
      return json(400, { error: '邮箱和密码必填' }, corsHeaders);
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const lower = String(email).trim().toLowerCase();

    // 1) 校验邀请：仅 status='待接受' 的有效邀请可注册
    const { data: inv, error: invErr } = await supabase
      .from('invites')
      .select('id, workspace_id, role, permissions')
      .eq('email', lower)
      .eq('status', '待接受')
      .maybeSingle();
    if (invErr) throw invErr;
    if (!inv) {
      return json(403, { error: '该项目仅接受受邀注册，请向管理员索取邀请后再注册。' }, corsHeaders);
    }

    // 2) 用 service_role 创建用户（强制邮箱确认，避免卡在验证邮件）
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email: lower,
      password,
      user_metadata: { name: (name || lower.split('@')[0]).toString() },
      email_confirm: true,
    });
    if (createErr) {
      return json(400, { error: zhAuth(createErr.message) }, corsHeaders);
    }
    const uid = created.user && created.user.id;
    if (!uid) return json(500, { error: '创建用户失败' }, corsHeaders);

    // 3) 把邀请转为 workspace_members（security definer，不受 manager 限制）
    const { error: accErr } = await supabase.rpc('accept_invite', { invite_id: inv.id });
    if (accErr) throw accErr;

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

function zhAuth(m: string): string {
  if (/User already registered/i.test(m)) return '该邮箱已注册，请直接登录';
  if (/Password should be at least/i.test(m)) return '密码太短，至少 6 位';
  return m;
}
