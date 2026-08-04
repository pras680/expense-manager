-- One-off repair for receipts saved while the app was stuck using a legacy insert
-- payload (see git history: SupabaseService.insertReceiptToDB used to have a sticky
-- "shouldUseLegacyReceiptInsert" flag that, once tripped by a single transient
-- schema-cache error, silently skipped several optional top-level columns for the
-- rest of the app session). Those rows still have the correct data nested inside
-- raw_ocr_json — this copies it back into the real columns wherever the column is
-- null but the JSON has a value.
--
-- Safe to run multiple times. Run in the Supabase SQL editor.

begin;

update public.receipts
set category = raw_ocr_json ->> 'category'
where category is null
  and coalesce(raw_ocr_json ->> 'category', '') <> '';

update public.receipts
set card_last4 = raw_ocr_json ->> 'card_last4'
where card_last4 is null
  and coalesce(raw_ocr_json ->> 'card_last4', '') <> '';

update public.receipts
set card_bank = raw_ocr_json ->> 'card_bank'
where card_bank is null
  and coalesce(raw_ocr_json ->> 'card_bank', '') <> '';

update public.receipts
set default_currency = raw_ocr_json ->> 'default_currency'
where default_currency is null
  and coalesce(raw_ocr_json ->> 'default_currency', '') <> '';

update public.receipts
set receipt_currency = raw_ocr_json ->> 'receipt_currency'
where receipt_currency is null
  and coalesce(raw_ocr_json ->> 'receipt_currency', '') <> '';

update public.receipts
set receipt_amount = (raw_ocr_json ->> 'receipt_amount')::numeric
where receipt_amount is null
  and coalesce(raw_ocr_json ->> 'receipt_amount', '') <> '';

update public.receipts
set conversion_rate = (raw_ocr_json ->> 'conversion_rate')::numeric
where conversion_rate is null
  and coalesce(raw_ocr_json ->> 'conversion_rate', '') <> '';

update public.receipts
set converted_total = (raw_ocr_json ->> 'converted_total')::numeric
where converted_total is null
  and coalesce(raw_ocr_json ->> 'converted_total', '') <> '';

commit;
