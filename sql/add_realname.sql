-- ============================================================================
--  成员「真实姓名」字段迁移
--  用法：Supabase 控制台 → SQL Editor → 全文粘贴 → Run（可重复执行，幂等）
--  说明：把真实姓名挂在「成员关系」上（invites / workspace_members），
--        而非 profiles；视图优先取 members.name，为空回退 profiles.name。
--        前端「添加成员」由管理员填写，注册页不再收集昵称。
-- ============================================================================

-- 1) 加列（已存在则跳过）
alter table public.invites add column if not exists name text;
alter table public.workspace_members add column if not exists name text;

-- 2) add_member：新增 member_name 形参
--    已注册 → 直接写入 workspace_members.name；未注册 → 写入 invites.name
create or replace function public.add_member(
  ws uuid, member_email text, member_role text default 'member',
  perms jsonb default '{}'::jsonb, member_name text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not public.is_manager(ws) then raise exception '只有管理员可以添加成员'; end if;
  if coalesce(trim(member_email),'') = '' then raise exception '邮箱不能为空'; end if;

  select id into uid from public.profiles where lower(email) = lower(trim(member_email)) limit 1;

  if uid is not null then
    insert into public.workspace_members (workspace_id, user_id, role, permissions, name)
    values (ws, uid, member_role, perms, nullif(trim(member_name), ''))
    on conflict (workspace_id, user_id)
      do update set role = excluded.role, permissions = excluded.permissions,
                    status = '已启用', name = coalesce(excluded.name, workspace_members.name);
    return 'joined';
  else
    insert into public.invites (workspace_id, email, role, permissions, created_by, name)
    values (ws, lower(trim(member_email)), member_role, perms, auth.uid(), nullif(trim(member_name), ''));
    return 'invited';
  end if;
end;
$$;

-- 3) accept_invite：接受邀请时把 invites.name 带入 workspace_members.name
create or replace function public.accept_invite(invite_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  iv record;
  uid uuid;
begin
  select * into iv from public.invites where id = invite_id and status = '待接受';
  if not found then raise exception '邀请不存在或已失效'; end if;
  select id into uid from public.profiles where lower(email) = iv.email limit 1;
  if uid is null then raise exception '账号尚未创建'; end if;
  insert into public.workspace_members (workspace_id, user_id, role, permissions, status, name)
  values (iv.workspace_id, uid, iv.role, iv.permissions, '已启用', nullif(trim(iv.name), ''))
  on conflict (workspace_id, user_id)
    do update set role = excluded.role, permissions = excluded.permissions,
                  status = '已启用', name = coalesce(excluded.name, workspace_members.name);
  update public.invites set status = '已接受' where id = invite_id;
end;
$$;

-- 4) workspace_members_view：coalesce(members.name, profiles.name)
drop function if exists public.workspace_members_view(uuid);
create or replace function public.workspace_members_view(ws uuid)
returns table (
  id uuid, user_id uuid, email text, name text,
  role text, permissions jsonb, status text, created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql security definer stable set search_path = public as $$
  select m.id, m.user_id, p.email, coalesce(m.name, p.name) as name, m.role, m.permissions, m.status, m.created_at,
         u.last_sign_in_at
    from public.workspace_members m
    left join public.profiles p on p.id = m.user_id
    left join auth.users u on u.id = m.user_id
   where m.workspace_id = ws and public.is_member(ws)
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.created_at;
$$;
