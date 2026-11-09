-- multiuser-23: report receipts the ask-spending totals couldn't count.
--
-- Requires multiuser-21. Safe to re-run.
--
-- ask_receipts.amount is null for a receipt in another currency with no
-- converted_total (same as the webapp), and sum() skips nulls, so those
-- receipts silently drop out of every total. The chat agent couldn't tell, and
-- when a user disputed a low figure it had no way to explain it. Each spend
-- function now also returns uncounted_receipts: rows matched but not summed.
--
-- Adding an output column changes the return type, which `create or replace`
-- refuses, hence drop + create; the grants go with the drop and are re-applied.
-- Nothing else depends on these functions (only the ask-spending edge function
-- calls them, and it passes results through as JSON, so old/new shapes both work).

drop function if exists public.ask_spending_by_category(date, date);
drop function if exists public.ask_spending_by_month(date, date, text);
drop function if exists public.ask_top_merchants(date, date, text, int);

create function public.ask_spending_by_category(p_from date, p_to date)
returns table (category text, total numeric, receipt_count bigint, uncounted_receipts bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(v.category, 'Uncategorised'), round(sum(v.amount), 2), count(*),
         count(*) filter (where v.amount is null)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
  group by 1
  order by 2 desc nulls last
$$;

create function public.ask_spending_by_month(p_from date, p_to date, p_category text default null)
returns table (month text, total numeric, receipt_count bigint, uncounted_receipts bigint)
language sql stable security invoker set search_path = public as $$
  select to_char(v.receipt_date, 'YYYY-MM'), round(sum(v.amount), 2), count(*),
         count(*) filter (where v.amount is null)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
    and (p_category is null or lower(v.category) = lower(p_category))
  group by 1
  order by 1
$$;

-- Merchant names grouped case-insensitively ("GRAB" and "Grab" are one).
create function public.ask_top_merchants(
  p_from date, p_to date, p_category text default null, p_limit int default 10
)
returns table (merchant text, total numeric, receipt_count bigint, uncounted_receipts bigint)
language sql stable security invoker set search_path = public as $$
  select max(v.merchant), round(sum(v.amount), 2), count(*),
         count(*) filter (where v.amount is null)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and v.merchant is not null
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
    and (p_category is null or lower(v.category) = lower(p_category))
  group by lower(trim(v.merchant))
  order by 2 desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

revoke execute on function public.ask_spending_by_category(date, date) from public, anon;
revoke execute on function public.ask_spending_by_month(date, date, text) from public, anon;
revoke execute on function public.ask_top_merchants(date, date, text, int) from public, anon;

grant execute on function public.ask_spending_by_category(date, date) to authenticated;
grant execute on function public.ask_spending_by_month(date, date, text) to authenticated;
grant execute on function public.ask_top_merchants(date, date, text, int) to authenticated;
