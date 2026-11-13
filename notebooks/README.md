# notebooks/ — ad-hoc analysis, outside the app

Jupyter notebooks for querying the live Supabase database directly. Nothing
here is part of the deployed webapp or edge functions — it's a scratch tool
that talks to the same Postgres instance from outside, using the database
password (bypasses RLS, same as the edge functions' service-role access).

## Setup (one-time)

```bash
cd notebooks
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# fill in DATABASE_URL (and SUPABASE_SERVICE_ROLE_KEY if you'll call
# parse-receipt directly) in .env — never commit this file
jupyter lab starter.ipynb
```

## When to reach for this

- **Investigating a reported issue** — "why wasn't this picked up", "why are
  there two of these" — pull the relevant receipts/`sms_inbox`/
  `gmail_scan_log` rows into a DataFrame and look at them interactively,
  instead of one `supabase db query` at a time. This is exactly what
  diagnosed the merchant-mismatch duplicate and the Gmail "too large" import
  failures earlier in this project — a notebook just makes that iterative
  instead of one-shot.
- **Prototyping a `parse-receipt` change** — new extracted field, prompt
  wording, a different model — call the function directly against real
  `raw_text` samples pulled from existing receipts (`raw_ocr_json->>'raw_text'`)
  and inspect the JSON it returns, without redeploying or re-forwarding an
  email each time you tweak something.
- **Sanity-checking a fix before it ships** — simulate new logic (a
  duplicate-check rule, a retry-budget change) as a pandas filter over real
  data first, so you know how many rows it would affect before writing the
  migration or edge-function change for real.

## When *not* to use it

- Never as a way to insert/update production data casually — the one time
  this session inserted receipts directly by hand (bypassing the normal
  ingestion pipeline, and its duplicate check), it created two duplicates
  that had to be found and deleted again. Prefer read-only exploration here;
  route actual writes through the app or a reviewed migration script.
- Never commit `.env`, an API key, or a household's real data pasted into a
  markdown cell — notebooks get committed with their output cells attached
  unless you clear them first.

## Secrets

`.env` (gitignored) holds `DATABASE_URL` (DB password, for reads) and
optionally `SUPABASE_SERVICE_ROLE_KEY` (only needed to call an edge function
directly). Never put either in a cell, a commit, or a chat message.

## Jev feasibility stub (`jev_feasibility.py`)

Tests whether TypeSafe AI's Jev classifies our receipts well enough for
ADR-0003 (category review flags) and ADR-0001 (merchant tags). Read-only on
the database; results go to `jev_out/` (gitignored, contains real merchant names).

```bash
source .venv/bin/activate
python jev_feasibility.py probe                         # 1 call: see Jev's raw response shape first
python jev_feasibility.py categories --dry-run --limit 3 # see exactly what would be sent
python jev_feasibility.py categories --limit 200        # accuracy, calibration, flag simulation
python jev_feasibility.py tags --limit 60               # origin / venue_type CSV for you to mark
python jev_feasibility.py tags-score                    # score it after marking expected_* columns
python jev_feasibility.py rescore                       # re-parse saved responses, no API calls
```

By default only merchant, source and line items are sent; add
`--include-raw-text` to also send the first 1,200 characters of receipt text.
