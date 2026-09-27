-- Splits the built-in "Travel" category in two: "Commute" (a new built-in)
-- now covers local getting-around — rideshare/taxis, public transit,
-- parking/ERP — and "Travel" keeps flights, hotels, car rentals and trip
-- bookings. The code side of this (webapp categories.ts, parse-receipt's
-- prompt, iOS Invoice.swift) ships separately; deploy parse-receipt and the
-- webapp FIRST, then run this, so nothing new lands as local-transport
-- "Travel" after the backfill has already run.
--
-- What this moves, and what it doesn't:
--
-- 1. receipts: a Travel row becomes Commute only when its merchant or comment
--    matches one of the local-transport keywords below. Anything that doesn't
--    match stays Travel — a flight or hotel is the correct answer there, and
--    an unrecognised merchant is better fixed by hand in the app than guessed
--    at here. Only category = 'Travel' rows are touched, so e.g. a GrabFood
--    order (Food & Dining) can never be pulled in by the "grab" keyword.
--    \m...\M are Postgres word boundaries, so "bus" doesn't match "business".
--
-- 2. receipt_correction_rules: a learned rule that says "this merchant is
--    Travel" would keep steering future SMS/Gmail imports back into Travel —
--    the same keyword test is applied to its keyword/corrected merchant.
--
-- 3. household_categories: a household that already added its own custom
--    "Commute" would now see it twice (the built-in plus its row). The row is
--    dropped; receipts.category is plain text, so every receipt already filed
--    under that name simply becomes the built-in one, unchanged.
--
-- Preview what step 1 will move before running:
--
--   select id, date, merchant, total, comment
--   from public.receipts
--   where category = 'Travel'
--     and (coalesce(merchant, '') || ' ' || coalesce(comment, '')) ~* '\m(grab|gojek|uber|lyft|taxi|cab|comfortdelgro|cdg|zig|tada|ryde|mrt|lrt|smrt|sbs|bus|transit|transitlink|simplygo|ez-?link|parking|car ?park|erp)\M'
--   order by date desc;
--
-- Run after multiuser-16-sms-inbox-rls-and-cleanup.sql. Safe to re-run.

begin;

update public.receipts
set category = 'Commute'
where category = 'Travel'
  and (coalesce(merchant, '') || ' ' || coalesce(comment, ''))
      ~* '\m(grab|gojek|uber|lyft|taxi|cab|comfortdelgro|cdg|zig|tada|ryde|mrt|lrt|smrt|sbs|bus|transit|transitlink|simplygo|ez-?link|parking|car ?park|erp)\M';

update public.receipt_correction_rules
set corrected_category = 'Commute'
where corrected_category = 'Travel'
  and (merchant_keyword || ' ' || coalesce(corrected_merchant, ''))
      ~* '\m(grab|gojek|uber|lyft|taxi|cab|comfortdelgro|cdg|zig|tada|ryde|mrt|lrt|smrt|sbs|bus|transit|transitlink|simplygo|ez-?link|parking|car ?park|erp)\M';

delete from public.household_categories
where lower(name) = 'commute';

commit;

-- Check afterwards:
--   select category, count(*) from public.receipts
--   where category in ('Travel', 'Commute') group by 1;
