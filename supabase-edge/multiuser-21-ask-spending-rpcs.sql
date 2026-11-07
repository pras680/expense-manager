-- multiuser-21: read-only spending RPCs for the ask-spending chat agent.
--
-- Requires multiuser-19 (converted_total / receipt_currency / default_currency
-- columns). Safe to re-run, including over an earlier version of this file.
--
-- SECURITY: the view is security_invoker and every function is SECURITY
-- INVOKER, so they run as the CALLING user and the receipts RLS policy
-- (is_visible_receipt) filters rows exactly as it does for the webapp. The
-- agent calls these with the user's JWT; it never sees a row the user
-- couldn't already see in Reports.
--
-- ONE place for the maths: the ask_receipts view mirrors
-- webapp/src/lib/receiptShape.ts (receiptFromRow) and categories.ts:
--   * top-level column first, raw_ocr_json.<field> as fallback, '' = null
--   * amount = converted_total, else total only when the receipt's currency
--     equals the reporting currency (else null — same as the webapp)
--   * category null is still an expense; Local Transfer / Credit Card Bill
--     Payment are not (filtered in the spend functions, not the view)
--   * receipts bucketed by their Asia/Singapore calendar day.

-- ---------------------------------------------------------------- helpers --

-- receipts.date predates the numbered migrations; the text round-trip keeps
-- this valid whether it's date, timestamptz, or ISO text.
create or replace function public.ask_receipt_local_date(p_date anyelement)
returns date language sql stable as $$
  select (p_date::text::timestamptz at time zone 'Asia/Singapore')::date
$$;

-- raw_ocr_json stores numbers as strings ("12.50", sometimes ""). Never throws.
create or replace function public.ask_to_numeric(p_text text)
returns numeric language sql immutable as $$
  select case when trim(p_text) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$'
              then trim(p_text)::numeric end
$$;

-- True when EVERY whitespace-separated word of p_search appears in p_text,
-- case-insensitively, in any order: "cheese pizza" matches "PIZZA - CHEESE 12in".
-- position() not LIKE, so % and _ are literal.
create or replace function public.ask_matches_all_words(p_text text, p_search text)
returns boolean language sql immutable as $$
  select coalesce(trim(p_search), '') <> ''
     and not exists (
       select 1 from regexp_split_to_table(lower(trim(p_search)), '\s+') as w
       where position(w in lower(coalesce(p_text, ''))) = 0)
$$;

-- ------------------------------------------------------------------- view --

create or replace view public.ask_receipts with (security_invoker = true) as
with base as (
  select r.*, coalesce(r.raw_ocr_json::jsonb, '{}'::jsonb) as j
  from public.receipts r
)
select
  b.id,
  public.ask_receipt_local_date(b.date) as receipt_date,
  b.merchant,
  coalesce(nullif(b.category, ''), nullif(b.j->>'category', '')) as category,
  coalesce(
    b.converted_total, public.ask_to_numeric(b.j->>'converted_total'),
    case when coalesce(nullif(b.receipt_currency, ''), nullif(b.j->>'receipt_currency', ''), nullif(b.currency, ''),
                       nullif(b.default_currency, ''), nullif(b.j->>'default_currency', ''), 'SGD')
            = coalesce(nullif(b.default_currency, ''), nullif(b.j->>'default_currency', ''), 'SGD')
         then b.total end
  ) as amount,
  coalesce(nullif(b.card_bank, ''), nullif(b.j->>'card_bank', '')) as card_bank,
  coalesce(nullif(b.card_last4, ''), nullif(b.j->>'card_last4', '')) as card_last4,
  b.comment,
  b.j->>'raw_text' as raw_text,
  case when jsonb_typeof(b.j->'line_items') = 'array' then b.j->'line_items' else '[]'::jsonb end as line_items
from base b;

revoke all on public.ask_receipts from public, anon;
grant select on public.ask_receipts to authenticated;

-- ------------------------------------------------------- spend aggregates --

create or replace function public.ask_spending_by_category(p_from date, p_to date)
returns table (category text, total numeric, receipt_count bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(v.category, 'Uncategorised'), round(sum(v.amount), 2), count(*)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
  group by 1
  order by 2 desc nulls last
$$;

create or replace function public.ask_spending_by_month(p_from date, p_to date, p_category text default null)
returns table (month text, total numeric, receipt_count bigint)
language sql stable security invoker set search_path = public as $$
  select to_char(v.receipt_date, 'YYYY-MM'), round(sum(v.amount), 2), count(*)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
    and (p_category is null or lower(v.category) = lower(p_category))
  group by 1
  order by 1
$$;

-- Merchant names grouped case-insensitively ("GRAB" and "Grab" are one).
create or replace function public.ask_top_merchants(
  p_from date, p_to date, p_category text default null, p_limit int default 10
)
returns table (merchant text, total numeric, receipt_count bigint)
language sql stable security invoker set search_path = public as $$
  select max(v.merchant), round(sum(v.amount), 2), count(*)
  from public.ask_receipts v
  where v.receipt_date between p_from and p_to
    and v.merchant is not null
    and coalesce(v.category, '') not in ('Local Transfer', 'Credit Card Bill Payment')
    and (p_category is null or lower(v.category) = lower(p_category))
  group by lower(trim(v.merchant))
  order by 2 desc nulls last
  limit least(greatest(coalesce(p_limit, 10), 1), 25)
$$;

-- ------------------------------------------------------ receipt lookups --

-- Individual receipts. INCLUDES transfers and card-bill payments, so "when did
-- I last pay my DBS card?" works. Text search covers merchant, comment, the
-- receipt's full transcription, and its line items (as the webapp search does).
create or replace function public.ask_find_receipts(
  p_search text default null, p_from date default null, p_to date default null,
  p_category text default null, p_limit int default 20
)
returns table (receipt_date date, merchant text, amount numeric, category text,
               card_bank text, card_last4 text, comment text)
language sql stable security invoker set search_path = public as $$
  select v.receipt_date, v.merchant, v.amount, v.category, v.card_bank, v.card_last4, v.comment
  from public.ask_receipts v
  where (p_from is null or v.receipt_date >= p_from)
    and (p_to   is null or v.receipt_date <= p_to)
    and (p_category is null or lower(v.category) = lower(p_category))
    and (coalesce(trim(p_search), '') = '' or public.ask_matches_all_words(
           concat_ws(' ', v.merchant, v.comment, v.raw_text, v.line_items::text), p_search))
  order by v.receipt_date desc nulls last
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ------------------------------------------------------------ line items --
-- raw_ocr_json.line_items = [{description, amount}], filled by the parser for
-- photo/PDF receipts. Email/SMS receipts usually have none, only raw_text.

create or replace function public.ask_find_line_items(
  p_search text, p_from date default null, p_to date default null, p_limit int default 30
)
returns table (receipt_date date, merchant text, description text, amount numeric)
language sql stable security invoker set search_path = public as $$
  select v.receipt_date, v.merchant, li->>'description', public.ask_to_numeric(li->>'amount')
  from public.ask_receipts v
  cross join lateral jsonb_array_elements(v.line_items) as li
  where (p_from is null or v.receipt_date >= p_from)
    and (p_to   is null or v.receipt_date <= p_to)
    and jsonb_typeof(li) = 'object'
    and public.ask_matches_all_words(li->>'description', p_search)
  order by v.receipt_date desc nulls last
  limit least(greatest(coalesce(p_limit, 30), 1), 100)
$$;

-- Counts computed by Postgres, not the model: LLMs are bad at counting rows.
-- other_receipts_mentioning = receipts whose transcription matches but which
-- have no matching line item (e.g. an emailed receipt with no itemisation).
create or replace function public.ask_line_item_summary(
  p_search text, p_from date default null, p_to date default null
)
returns table (times_bought bigint, receipts_with_item bigint, total_spent numeric,
               first_date date, last_date date, other_receipts_mentioning bigint)
language sql stable security invoker set search_path = public as $$
  with scoped as (
    select v.* from public.ask_receipts v
    where (p_from is null or v.receipt_date >= p_from)
      and (p_to   is null or v.receipt_date <= p_to)
  ), items as (
    select s.id, s.receipt_date, public.ask_to_numeric(li->>'amount') as amount
    from scoped s
    cross join lateral jsonb_array_elements(s.line_items) as li
    where jsonb_typeof(li) = 'object'
      and public.ask_matches_all_words(li->>'description', p_search)
  )
  select (select count(*) from items),
         (select count(distinct id) from items),
         (select round(sum(amount), 2) from items),
         (select min(receipt_date) from items),
         (select max(receipt_date) from items),
         (select count(*) from scoped s
           where public.ask_matches_all_words(s.raw_text, p_search)
             and s.id not in (select id from items))
$$;

-- ----------------------------------------------------------------- grants --

revoke execute on function public.ask_spending_by_category(date, date) from public, anon;
revoke execute on function public.ask_spending_by_month(date, date, text) from public, anon;
revoke execute on function public.ask_top_merchants(date, date, text, int) from public, anon;
revoke execute on function public.ask_find_receipts(text, date, date, text, int) from public, anon;
revoke execute on function public.ask_find_line_items(text, date, date, int) from public, anon;
revoke execute on function public.ask_line_item_summary(text, date, date) from public, anon;

grant execute on function public.ask_spending_by_category(date, date) to authenticated;
grant execute on function public.ask_spending_by_month(date, date, text) to authenticated;
grant execute on function public.ask_top_merchants(date, date, text, int) to authenticated;
grant execute on function public.ask_find_receipts(text, date, date, text, int) to authenticated;
grant execute on function public.ask_find_line_items(text, date, date, int) to authenticated;
grant execute on function public.ask_line_item_summary(text, date, date) to authenticated;
