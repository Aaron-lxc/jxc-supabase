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
      // 幂等兜底：找不到"待接受"邀请时，先确认该邮箱是否已在首次请求中注册并加入账套。
      // 典型场景：客户端重复提交导致首次已创建用户并消耗邀请，第二次再请求会走到这里；
      // 若确已注册且已是成员，则视为成功，前端直接去登录，避免误报 403。
      const { data: anyInv } = await supabase
        .from('invites')
        .select('workspace_id, status')
        .eq('email', lower)
        .maybeSingle();
      if (anyInv && anyInv.workspace_id) {
        const existingUser = await getUserByEmail(supabase, lower);
        if (existingUser) {
          const { data: member } = await supabase
            .from('workspace_members')
            .select('id')
            .eq('workspace_id', anyInv.workspace_id)
            .eq('user_id', existingUser.id)
            .maybeSingle();
          if (member) return json(200, { ok: true, already: true }, corsHeaders);
        }
      }
      return json(403, { error: '该项目仅接受受邀注册，请向管理员索取邀请后再注册。' }, corsHeaders);
    }

    // 2) 先查询该邮箱是否已注册：已注册则跳过创建，直接接受邀请
    //    （适用于「停用 / 删除成员后重新邀请」场景：auth 用户仍在，新建会报邮箱冲突）
    const existingUser = await getUserByEmail(supabase, lower);
    if (existingUser) {
      const { error: accErr } = await supabase.rpc('accept_invite', { invite_id: inv.id });
      if (accErr) throw accErr;
      return json(200, { ok: true, already: true }, corsHeaders);
    }

    // 3) 未注册才用 service_role 创建用户（强制邮箱确认，避免卡在验证邮件）
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

    // 4) 把邀请转为 workspace_members（security definer，不受 manager 限制）
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

// 当前 Edge Function 使用的 supabase-js@2 中 auth.admin.getUserByEmail 不存在，
// 用 service_role 直接查 auth.users 表代替。
async function getUserByEmail(supabase: any, email: string) {
  const { data, error } = await supabase
    .schema('auth')
    .from('users')
    .select('id, email')
    .eq('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function zhAuth(m: string): string {
  if (/already registered|already been registered/i.test(m)) return '该邮箱已注册，请直接登录';
  if (/Password should be at least/i.test(m)) return '密码太短，至少 6 位';
  return m;
}
