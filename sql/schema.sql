-- ============================================================================
--  进销存管理系统 · Supabase 版 · 数据库初始化脚本
--  用法：Supabase 控制台 → SQL Editor → New query → 全文粘贴 → Run
--  可重复执行（幂等）
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 一、表结构
-- ============================================================================

-- 用户资料（镜像 auth.users，便于按邮箱邀请成员）
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  created_at timestamptz not null default now()
);

-- 账套（一个公司 / 一个门店 = 一个账套，数据完全隔离）
create table if not exists public.workspaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 账套成员（角色 + 按菜单模块的细粒度授权）
--   role        : owner（创建者，全权，不可移除） | admin（管理员，全权） | member（按 permissions）
--   permissions : {"sales":"edit","goods":"view","finance":"none", ...}
create table if not exists public.workspace_members (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member',
  permissions  jsonb not null default '{}'::jsonb,
  status       text not null default '已启用',
  name         text,
  created_at   timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index if not exists idx_members_user on public.workspace_members(user_id);
create index if not exists idx_members_ws   on public.workspace_members(workspace_id);

-- 业务数据（文档行模型：一行 = 一条业务记录，行级并发，互不覆盖）
--   coll : 集合名，对应原单机版 db 的顶层键（sales / customers / goods ...）
--   rid  : 记录 id（统一转字符串存放）；单对象集合（meta / settings）固定为 '_'
create table if not exists public.records (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  coll         text not null,
  rid          text not null,
  data         jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  primary key (workspace_id, coll, rid)
);
create index if not exists idx_records_ws_coll on public.records(workspace_id, coll);

-- 邀请（被邀请人尚未注册时暂存，注册后自动入伙）
create table if not exists public.invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null,
  role         text not null default 'member',
  permissions  jsonb not null default '{}'::jsonb,
  name         text,
  status       text not null default '待接受' check (status in ('待接受', '已接受', '已取消')),
  created_by   uuid,
  created_at   timestamptz not null default now()
);
create index if not exists idx_invites_email on public.invites(lower(email));

-- ============================================================================
-- 二、权限判定函数（security definer，避免 RLS 递归）
-- ============================================================================

-- 是否为账套的有效成员
create or replace function public.is_member(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = ws and m.user_id = auth.uid() and m.status = '已启用'
  );
$$;

-- 当前用户在账套中的角色
create or replace function public.my_role(ws uuid)
returns text language sql security definer stable set search_path = public as $$
  select m.role from public.workspace_members m
   where m.workspace_id = ws and m.user_id = auth.uid() and m.status = '已启用'
   limit 1;
$$;

-- 是否为账套管理者（owner / admin）
create or replace function public.is_manager(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.my_role(ws) in ('owner','admin'), false);
$$;

-- 集合 → 菜单模块 映射
create or replace function public.coll_module(c text)
returns text language sql immutable as $$
  select case c
    when 'goods'              then 'goods'
    when 'goodsTypes'         then 'goods'
    when 'units'              then 'goods'
    when 'suppliers'          then 'goods'
    when 'customers'          then 'customers'
    when 'custLevels'         then 'customers'
    when 'custTypes'          then 'customers'
    when 'regions'            then 'customers'
    when 'resourcePartners'   then 'partners'
    when 'regionPartners'     then 'partners'
    when 'resourceRates'      then 'commission'
    when 'regionRates'        then 'commission'
    when 'commissionPayments' then 'commission'
    when 'warehouses'         then 'warehouse'
    when 'purchases'          then 'purchase'
    when 'stocks'             then 'inventory'
    when 'stockChecks'        then 'inventory'
    when 'losses'             then 'loss'
    when 'overflows'          then 'overflow'
    when 'sales'              then 'sales'
    when 'returns'            then 'sales'
    when 'expenseCats'        then 'finance'
    when 'expenses'           then 'finance'
    when 'complaintTypes'     then 'complaint'
    when 'complaints'         then 'complaint'
    when 'settings'           then 'settings'
    else '__shared__'
  end;
$$;

-- 是否拥有任意模块的编辑权（用于 meta 单号计数等共享集合）
create or replace function public.has_any_edit(ws uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when public.is_manager(ws) then true
    else exists (
      select 1
        from public.workspace_members m,
             lateral jsonb_each_text(m.permissions) kv
       where m.workspace_id = ws and m.user_id = auth.uid()
         and m.status = '已启用' and kv.value = 'edit'
    )
  end;
$$;

-- 能否写入某集合
--   · owner / admin：全部可写
--   · stocks / stockChecks：采购入库与销售出库都会联动库存，故只要有任意编辑权即可写
--   · meta 等共享集合：同上
--   · 其余：按 集合→模块 的 edit 授权判定
create or replace function public.can_write_coll(ws uuid, c text)
returns boolean language sql security definer stable set search_path = public as $$
  select case
    when public.is_manager(ws) then true
    when c in ('stocks','stockChecks') or public.coll_module(c) = '__shared__'
      then public.has_any_edit(ws)
    else coalesce((
      select m.permissions ->> public.coll_module(c) = 'edit'
        from public.workspace_members m
       where m.workspace_id = ws and m.user_id = auth.uid() and m.status = '已启用'
       limit 1
    ), false)
  end;
$$;

-- 与当前用户同属至少一个账套（用于成员管理页读取彼此邮箱）
create or replace function public.shares_workspace(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1
      from public.workspace_members a
      join public.workspace_members b on a.workspace_id = b.workspace_id
     where a.user_id = auth.uid() and b.user_id = uid
  );
$$;

-- ============================================================================
-- 三、行级安全策略（RLS）
-- ============================================================================

alter table public.profiles          enable row level security;
alter table public.workspaces        enable row level security;
alter table public.workspace_members enable row level security;
alter table public.records           enable row level security;
alter table public.invites           enable row level security;

-- ---- profiles ----
drop policy if exists p_profiles_select on public.profiles;
create policy p_profiles_select on public.profiles for select
  using (id = auth.uid() or public.shares_workspace(id));

drop policy if exists p_profiles_upsert on public.profiles;
create policy p_profiles_upsert on public.profiles for insert
  with check (id = auth.uid());

drop policy if exists p_profiles_update on public.profiles;
create policy p_profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- ---- workspaces ----
drop policy if exists p_ws_select on public.workspaces;
create policy p_ws_select on public.workspaces for select
  using (public.is_member(id) or owner_id = auth.uid());

drop policy if exists p_ws_insert on public.workspaces;
create policy p_ws_insert on public.workspaces for insert
  with check (owner_id = auth.uid());

drop policy if exists p_ws_update on public.workspaces;
create policy p_ws_update on public.workspaces for update
  using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists p_ws_delete on public.workspaces;
create policy p_ws_delete on public.workspaces for delete
  using (owner_id = auth.uid());

-- ---- workspace_members ----
drop policy if exists p_mem_select on public.workspace_members;
create policy p_mem_select on public.workspace_members for select
  using (user_id = auth.uid() or public.is_member(workspace_id));

drop policy if exists p_mem_insert on public.workspace_members;
create policy p_mem_insert on public.workspace_members for insert
  with check (
    public.is_manager(workspace_id)
    or exists (select 1 from public.workspaces w
                where w.id = workspace_id and w.owner_id = auth.uid())
  );

drop policy if exists p_mem_update on public.workspace_members;
create policy p_mem_update on public.workspace_members for update
  using (public.is_manager(workspace_id))
  with check (public.is_manager(workspace_id));

-- 管理员可移除成员；owner 记录受保护（见触发器）
drop policy if exists p_mem_delete on public.workspace_members;
create policy p_mem_delete on public.workspace_members for delete
  using (public.is_manager(workspace_id) and role <> 'owner');

-- ---- records ----
-- 读：账套内「非报表成员」皆可读（跨模块统计、报表、下拉引用需要完整数据）
--     报表接收人(role='报表')被本策略排除，改由 report-detail 函数(service_role)按 profile 裁剪返回
--     菜单级可见性由前端按 permissions 控制，写入权限由下方策略强制
drop policy if exists p_rec_select on public.records;
create policy p_rec_select on public.records for select
  using (public.is_member(workspace_id) and public.my_role(workspace_id) <> '报表');

drop policy if exists p_rec_insert on public.records;
create policy p_rec_insert on public.records for insert
  with check (public.can_write_coll(workspace_id, coll));

drop policy if exists p_rec_update on public.records;
create policy p_rec_update on public.records for update
  using (public.can_write_coll(workspace_id, coll))
  with check (public.can_write_coll(workspace_id, coll));

drop policy if exists p_rec_delete on public.records;
create policy p_rec_delete on public.records for delete
  using (public.can_write_coll(workspace_id, coll));

-- ---- invites ----
drop policy if exists p_inv_select on public.invites;
create policy p_inv_select on public.invites for select
  using (public.is_manager(workspace_id) or lower(email) = lower(coalesce(auth.jwt() ->> 'email','')));

drop policy if exists p_inv_insert on public.invites;
create policy p_inv_insert on public.invites for insert
  with check (public.is_manager(workspace_id));

drop policy if exists p_inv_delete on public.invites;
create policy p_inv_delete on public.invites for delete
  using (public.is_manager(workspace_id));

drop policy if exists p_inv_update on public.invites;
create policy p_inv_update on public.invites for update
  using (public.is_manager(workspace_id))
  with check (public.is_manager(workspace_id));

-- ============================================================================
-- 四、触发器
-- ============================================================================

-- 新用户注册 → 建 profile → 自动消费待接受邀请
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email,'@',1)))
  on conflict (id) do update set email = excluded.email;

  insert into public.workspace_members (workspace_id, user_id, role, permissions)
  select i.workspace_id, new.id, i.role, i.permissions
    from public.invites i
   where lower(i.email) = lower(new.email) and i.status = '待接受'
  on conflict (workspace_id, user_id) do nothing;

  update public.invites set status = '已接受'
   where lower(email) = lower(new.email) and status = '待接受';

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 保护：禁止删除 owner 成员记录
create or replace function public.protect_owner_member()
returns trigger language plpgsql as $$
begin
  if old.role = 'owner' then
    raise exception '不能移除账套创建者';
  end if;
  return old;
end;
$$;

drop trigger if exists trg_protect_owner on public.workspace_members;
create trigger trg_protect_owner
  before delete on public.workspace_members
  for each row execute function public.protect_owner_member();

-- records 自动维护 updated_at / updated_by
create or replace function public.touch_record()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_record on public.records;
create trigger trg_touch_record
  before insert or update on public.records
  for each row execute function public.touch_record();

-- ============================================================================
-- 五、RPC（前端调用的原子操作）
-- ============================================================================

-- 创建账套：建账套 + 把自己设为 owner，一步到位
create or replace function public.create_workspace(ws_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  if coalesce(trim(ws_name),'') = '' then raise exception '账套名称不能为空'; end if;

  -- 仅账套创建者(owner)可新建账套：全局已有账套时，要求调用者在某已启用账套中为 owner
  if exists(select 1 from public.workspaces) then
    if not exists(
      select 1 from public.workspace_members m
      where m.user_id = auth.uid() and m.status = '已启用' and m.role = 'owner'
    ) then
      raise exception '只有账套创建者可以创建新账套';
    end if;
  end if;

  insert into public.workspaces (name, owner_id) values (trim(ws_name), auth.uid())
  returning id into new_id;

  insert into public.workspace_members (workspace_id, user_id, role, permissions)
  values (new_id, auth.uid(), 'owner', '{}'::jsonb);

  return new_id;
end;
$$;

-- 全局是否已有任意账套（用于「建账套」权限判断：首个账套放开，之后仅管理员可建）
-- security definer 绕过 RLS，读取全局是否存在账套
create or replace function public.any_workspace_exists()
returns boolean language sql security definer set search_path = public as $$
  select exists(select 1 from public.workspaces);
$$;

-- 添加成员：已注册直接入伙；未注册写入邀请，注册后自动生效
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

-- 接受邀请：把 invites 记录转为 workspace_members（供 Edge Function 用 service_role 调用）
-- security definer 绕过 RLS 与 manager 限制，仅校验邀请本身有效
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

-- 我的账套列表（含我的角色与权限）
create or replace function public.my_workspaces()
returns table (
  id uuid, name text, owner_id uuid, role text,
  permissions jsonb, created_at timestamptz, member_count bigint
)
language sql security definer stable set search_path = public as $$
  select w.id, w.name, w.owner_id, m.role, m.permissions, w.created_at,
         (select count(*) from public.workspace_members x where x.workspace_id = w.id)
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
   where m.user_id = auth.uid() and m.status = '已启用'
   order by w.created_at;
$$;

-- 账套成员清单（含邮箱与最新登录时间）
-- 注意：返回列变更时必须先 DROP 再 CREATE（Postgres 不允许 create or replace 改返回类型）
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

-- 转让账套所有权
create or replace function public.transfer_ownership(ws uuid, new_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = ws and w.owner_id = auth.uid()) then
    raise exception '只有账套创建者可以转让';
  end if;
  if not exists (select 1 from public.workspace_members m
                  where m.workspace_id = ws and m.user_id = new_owner) then
    raise exception '目标用户不是本账套成员';
  end if;

  update public.workspace_members set role = 'admin'
   where workspace_id = ws and user_id = auth.uid();
  update public.workspace_members set role = 'owner'
   where workspace_id = ws and user_id = new_owner;
  update public.workspaces set owner_id = new_owner where id = ws;
end;
$$;

-- ============================================================================
-- 六、Realtime（多人同时在线时自动同步）
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'records'
  ) then
    alter publication supabase_realtime add table public.records;
  end if;
exception when others then
  raise notice '跳过 realtime 发布配置：%', sqlerrm;
end $$;

alter table public.records replica identity full;

-- ============================================================================
-- 完成。返回一行提示。
-- ============================================================================
select '进销存管理系统 · Supabase 初始化完成' as status;
