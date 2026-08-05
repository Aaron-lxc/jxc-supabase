-- ============================================================================
-- 报表中心：接收人档案 + 收紧 records 读取权限
-- 在已执行 schema.sql 的库上执行（可重复执行，幂等）
-- ============================================================================

-- 接收人档案：一个登录用户在某账套里对应“看哪类报表”
create table if not exists public.recipient_profiles (
  id           bigint generated always as identity primary key,
  auth_uid     uuid not null references auth.users(id) on delete cascade,
  ws_id        uuid not null references public.workspaces(id) on delete cascade,
  role         text not null check (role in ('resource','region','arrears','stock','manager')),
  partner_id   bigint,                 -- 仅合伙人需要（对应 resourcePartners/regionPartners 的 id）
  partner_type text,                   -- '资源' / '区域'
  partner_name text,
  status       text not null default '启用' check (status in ('启用','未启用')),
  created_at   timestamptz not null default now(),
  last_read_at timestamptz,
  unique (auth_uid, ws_id)
);
create index if not exists idx_rp_ws on public.recipient_profiles(ws_id);

alter table public.recipient_profiles enable row level security;
drop policy if exists p_rp_select on public.recipient_profiles;
create policy p_rp_select on public.recipient_profiles for select
  using (auth.uid() = auth_uid or public.is_manager(ws_id));
drop policy if exists p_rp_write on public.recipient_profiles;
create policy p_rp_write on public.recipient_profiles for all
  using (public.is_manager(ws_id)) with check (public.is_manager(ws_id));

-- 收紧：报表成员（role='报表'）不能直接读 records 原始数据；其余成员照旧
-- （报表函数用 service_role 读，不受此 RLS 影响）
drop policy if exists p_rec_select on public.records;
create policy p_rec_select on public.records for select
  using (public.is_member(workspace_id) and public.my_role(workspace_id) <> '报表');
