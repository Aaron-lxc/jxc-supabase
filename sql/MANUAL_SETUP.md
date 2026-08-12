# 手动执行 SQL 清单（Supabase）

> 本仓库的静态前端（H5 进销存）通过 GitHub Pages 部署，**数据库结构 / 函数 / RPC 不会随 git 自动生效**。
> 以下 SQL 需在 **Supabase 控制台 → SQL Editor → New query → 粘贴 → Run** 手动执行一次。
> 大部分脚本使用 `create or replace` / `if not exists`，可重复执行（幂等），不会破坏现有数据。

---

## 任务 1：客户级别自动评定函数（必做）

用途：在数据库建立 `eval_customer_levels()` 函数，按「净额 / 月数 / 区间首档」重算每个客户的 `levelId`。
口径与前端 `store.evalCustomerLevels` 完全一致（净额 = 已完成销售单 total 之和 − 关联退货单 total 之和）。

```sql
create or replace function eval_customer_levels() returns void
language plpgsql security definer as $$
declare
  r record;
  c record;
  gross numeric;
  ret numeric;
  net numeric;
  first_month date;
  months int;
  avg_val numeric;
  match_id text;
begin
  for r in select distinct ws from records where coll = 'customers' loop
    for c in select data from records where coll = 'customers' and ws = r.ws loop
      select coalesce(sum((s.data->>'total')::numeric), 0)
        into gross
        from records s
        where s.coll = 'sales' and s.ws = r.ws
          and s.data->>'customerId' = c.data->>'id'
          and s.data->>'status' = '已完成';
      select coalesce(sum((rt.data->>'total')::numeric), 0)
        into ret
        from records rt
        join records s on s.coll = 'sales' and s.ws = r.ws and s.data->>'id' = rt.data->>'saleId'
        where rt.coll = 'returns' and rt.ws = r.ws
          and s.data->>'customerId' = c.data->>'id';
      net := gross - ret;
      select min(to_date(left(coalesce(s.data->>'finishTime', s.data->>'createTime', s.data->>'time'), 10), 'YYYY-MM-DD'))
        into first_month
        from records s
        where s.coll = 'sales' and s.ws = r.ws
          and s.data->>'customerId' = c.data->>'id'
          and s.data->>'status' = '已完成';
      if first_month is null then
        months := 1;
      else
        months := greatest(1,
          (extract(year from current_date) * 12 + extract(month from current_date))
          - (extract(year from first_month) * 12 + extract(month from first_month)) + 1);
      end if;
      avg_val := case when months > 0 then net / months else 0 end;
      select lv.data->>'id' into match_id
      from records lv
      where lv.coll = 'custLevels' and lv.ws = r.ws and lv.data->>'status' = '已启用'
        and (lv.data->>'minAmount')::numeric <= avg_val
        and ( (lv.data->>'maxAmount') is null or (lv.data->>'maxAmount')::numeric is null or (lv.data->>'maxAmount')::numeric > avg_val )
      order by (lv.data->>'minAmount')::numeric asc
      limit 1;
      if match_id is not null then
        update records set data = jsonb_set(data, '{levelId}', to_jsonb(match_id))
        where coll = 'customers' and ws = r.ws and data->>'id' = c.data->>'id';
      end if;
    end loop;
  end loop;
end;
$$;
```

执行完成后，可随时在 SQL Editor 跑 `select eval_customer_levels();` 立即对所有账套重算客户级别。

> 说明：每月 1 号服务端自动评定的 `pg_cron` 定时任务为**可选增强**。前端已在每次打开应用时做兜底补评（比对 `meta.lastLevelEval` 按月自动重算），因此即便不配置 cron，功能也正常。免费版 pg_cron 可能受限，故默认不强制启用（详见 `sql/eval_customer_levels.sql` 第 75–76 行注释）。

---

## 任务 2：确认 / 修复 create_workspace 的 owner 校验（建议做）

用途：`create_workspace` RPC 负责「建账套 + 设为 owner」。2026-08-08 起已加入**仅 owner 可新建账套**的数据库层校验。若初装 `schema.sql` 在那天之前执行过，线上仍是旧版（无校验，仅靠前端拦截），需重跑以生效。

### 第 1 步：验证线上是否已是最新版

```sql
select routine_definition
from information_schema.routines
where routine_name = 'create_workspace' and routine_schema = 'public';
```

- 结果含 `只有账套创建者可以创建新账套` → 已生效，无需操作。
- 结果为空（函数不存在）或**不含**上述字样 → 未生效 / 旧版，需修复。

### 第 2 步：修复（二选一，均幂等安全）

- **省事**：把 `sql/schema.sql` 全文再粘贴执行一次（全 `if not exists` / `create or replace`，不破坏数据）。
- **精准**：只重跑下面的 `create_workspace` 函数块：

```sql
create or replace function public.create_workspace(ws_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception '未登录'; end if;
  if coalesce(trim(ws_name),'') = '' then raise exception '账套名称不能为空'; end if;

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
```

---

## 执行顺序建议

1. 先执行**任务 1**（客户级别评定函数）。
2. 再跑任务 2 的**验证 SQL**，按结果决定是否执行修复。

两任务互不依赖，顺序可调。
