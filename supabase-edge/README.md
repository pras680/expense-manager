Supabase Edge Function: parse-receipt

Purpose
- Accepts OCR'd `raw_text` from the client and uses Anthropic Claude 3.5 Sonnet to extract structured invoice fields (merchant, date, total, currency, extracted_digits, category, line_items).

Setup
1. Install Supabase CLI: https://supabase.com/docs/guides/cli
2. Log in and link to your project: `supabase login` then `supabase link --project-ref <ref>`
3. Set environment variables for the function:
   - `ANTHROPIC_API_KEY` — your Anthropic API key
   - (optional) `ANTHROPIC_API_URL`
4. Deploy the function:

```bash
cd supabase-edge/parse-receipt
supabase functions deploy parse-receipt
```

Usage
- POST JSON to the function URL with `{ "raw_text": "..." }`.
- The function returns a JSON object with the parsed fields.

Notes
- The prompt enforces a JSON-only assistant reply; you may need to adapt parsing if the LLM returns additional text.
- For higher accuracy, consider sending image binary or PDF and running OCR server-side (with Tesseract or Vision) before LLM parsing.

---

Supabase Edge Function: receive-sms

Purpose
- Ingests forwarded bank/payment SMS text (e.g. from an iOS Shortcuts automation) into the `sms_inbox` table so the app's "Scan SMS" feature can pick up unprocessed messages.

Setup
1. Run `sms-inbox-schema.sql` in the Supabase SQL editor to create the `sms_inbox` table and RLS policies.
2. Set environment variables for the function:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — used to insert with RLS bypassed
   - `SMS_INGEST_SECRET` — shared secret required in the `x-sms-ingest-secret` header
3. Deploy the function:

```bash
cd supabase-edge/receive-sms
supabase functions deploy receive-sms
```

Usage
- POST JSON to the function URL with `{ "body": "...", "sender": "...", "source": "ios-shortcut" }` and header `x-sms-ingest-secret: <SMS_INGEST_SECRET>`.
- Rows are inserted with `status = 'pending'`. The app's Tools → Scan SMS action reads pending/failed rows oldest-first, parses each into a receipt for review, and marks the row `processed`, `skipped`, or `failed` so nothing is imported twice.
