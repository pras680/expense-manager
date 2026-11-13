-- Backfills receipt_correction_rules (the household's learned
-- merchant -> category "tags") from receipts that already exist.
--
-- Why: learn_receipt_correction only fires when someone *changes* a field
-- or types a comment while saving (ReceiptForm -> learnReceiptCorrection).
-- Every receipt that was correct first time, or that predates
-- multiuser-14, never produced a rule, so match_correction_rules has very
-- little to hand parse-receipt as learning_hints on SMS/Gmail imports.
--
-- What it learns, and from what:
--
-- 1. Only receipts a person has vouched for: reviewed_at is not null, or
--    source is manual/photo (typed or confirmed in the form). Unreviewed
--    SMS/Gmail parses are the LLM's guess, and learning from them would
--    just feed the model its own mistakes back.
--
-- 2. Keyword = the merchant normalized exactly like the webapp's
--    normalizedCorrectionKey (supabaseClient.ts) / iOS normalizedMerchantKey:
--    lowercase, non-alphanumerics -> space, stop-words dropped. Keywords
--    under 3 chars and "unknown bank" are skipped, same as the RPC.
--
-- 3. One rule per (household, keyword). If the household's receipts for
--    that merchant disagree on category, the most frequent one wins, ties
--    broken by the most recent receipt. corrected_merchant is the most
--    recent spelling within the winning category.
--
-- 4. Only merchant + category are learned. Currency and card are
--    per-transaction facts, not properties of a merchant — a rule pinning
--    "ntuc -> card 1234" would mis-tag the next purchase on another card.
--
-- 5. Skipped on purpose:
--    - 'Local Transfer' / 'Credit Card Bill Payment': their "merchant" is
--      usually a bank name, and match_correction_rules is a substring test
--      on the raw message — a "uob" rule would fire on every UOB alert.
--    - Receipts whose merchant is just the card's bank (the Gmail
--      "merchant = UOB" case from the duplicate-detection notes), same reason.
--
-- 6. Never overwrites an existing rule (on conflict do nothing) — those
--    came from real corrections and are more trustworthy than a tally.
--
-- Dry run first: change the final `commit;` to `rollback;` — the insert's
-- `returning` list prints every rule it would create, then nothing is kept.
--
-- Undo (removes only rows this script created and nobody has since
-- re-learned — a real correction rewrites note):
--   delete from public.receipt_correction_rules
--   where note like 'Backfilled from %';
--
-- Run after multiuser-14-receipt-comment-and-learning.sql. Safe to re-run:
-- a second run only adds keywords that gained a trusted receipt since.

begin;

with trusted as (
  select r.household_id,
         trim(r.merchant) as merchant,
         r.category,
         r.date,
         r.card_bank
  from public.receipts r
  where r.household_id is not null
    and r.merchant is not null and trim(r.merchant) <> ''
    and r.category is not null and trim(r.category) <> ''
    and r.category not in ('Local Transfer', 'Credit Card Bill Payment')
    and (r.reviewed_at is not null or r.source in ('manual', 'photo'))
    and lower(trim(r.merchant)) <> lower(trim(coalesce(r.card_bank, '')))
),
keyed as (
  select t.*,
         (select string_agg(tok, ' ')
          from unnest(regexp_split_to_array(
                 trim(regexp_replace(lower(t.merchant), '[^[:alnum:]]+', ' ', 'g')),
                 '\s+')) as u(tok)
          where tok <> ''
            and tok not in ('email','subject','from','gmail','receipt','invoice','bill',
                            'payment','confirmation','statement','alert','notification',
                            'card','credit')
         ) as keyword
  from trusted t
),
tallied as (
  select household_id, keyword, category,
         count(*) as receipt_count,
         max(date) as last_seen,
         (array_agg(merchant order by date desc))[1] as latest_merchant
  from keyed
  where keyword is not null
    and length(keyword) >= 3
    and keyword <> 'unknown bank'
  group by household_id, keyword, category
),
winners as (
  select distinct on (household_id, keyword)
         household_id, keyword, category, receipt_count, latest_merchant
  from tallied
  order by household_id, keyword, receipt_count desc, last_seen desc
)
insert into public.receipt_correction_rules (
  household_id, merchant_keyword, corrected_merchant, corrected_category, note
)
select household_id,
       keyword,
       latest_merchant,
       category,
       'Backfilled from ' || receipt_count || ' past receipt'
         || case when receipt_count = 1 then '' else 's' end
         || ' filed as ' || category
from winners
on conflict (household_id, merchant_keyword) do nothing
returning household_id, merchant_keyword, corrected_merchant, corrected_category, note;

commit;

-- Check afterwards:
--   select household_id,
--          count(*) filter (where note like 'Backfilled from %') as backfilled,
--          count(*) as total_rules
--   from public.receipt_correction_rules group by 1;
