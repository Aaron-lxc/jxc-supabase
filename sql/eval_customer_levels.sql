-- 客户级别自动评定（每月1号执行）
-- 口径与前端 store.evalCustomerLevels 完全一致：
--   净额 = 该客户「已完成销售单 total 之和」 − 该客户「退货单 total 之和」
--   月数 = (当前年月 − 首次已完成销售年月) + 1（下限 1）
--   平均月采购额 = 净额 / 月数
--   匹配 custLevels 中 minAmount <= avg < maxAmount 的首个级别（maxAmount 为 null 视为 ∞）
--
-- 注意：本文件不会随 git 自动生效，需在 Supabase SQL Editor 手动执行一次。
-- 前置：项目需启用 pg_cron 扩展（免费版可能受限 —— 前端已在打开应用时做兜底补评）。

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
  -- 遍历每个账套（records 按 ws 隔离）
  for r in select distinct ws from records where coll = 'customers' loop
    -- 逐客户计算
    for c in select data from records where coll = 'customers' and ws = r.ws loop
      -- 已完成销售总额
      select coalesce(sum((s.data->>'total')::numeric), 0)
        into gross
        from records s
        where s.coll = 'sales' and s.ws = r.ws
          and s.data->>'customerId' = c.data->>'id'
          and s.data->>'status' = '已完成';
      -- 退货总额（经 saleId 关联回该客户）
      select coalesce(sum((rt.data->>'total')::numeric), 0)
        into ret
        from records rt
        join records s on s.coll = 'sales' and s.ws = r.ws and s.data->>'id' = rt.data->>'saleId'
        where rt.coll = 'returns' and rt.ws = r.ws
          and s.data->>'customerId' = c.data->>'id';
      net := gross - ret;
      -- 首次已完成销售时间
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
      -- 匹配级别：升序取首个命中（最高一档建议 maxAmount 留空/null = ∞）
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

-- 启用定时任务（需项目已开启 pg_cron 扩展；取消注释执行一次）：
-- select cron.schedule('eval_levels_monthly', '0 2 1 * *', 'select eval_customer_levels()');
