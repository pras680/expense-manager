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
