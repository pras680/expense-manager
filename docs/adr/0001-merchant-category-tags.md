# ADR-0001: Tags keyed by merchant + category, resolved at query time

- **Status:** Proposed
- **Date:** 2026-11-01
- **Area:** receipts schema, parse-receipt, ingestion pipelines (webapp, scan-gmail, process-sms-inbox), ask-spending agent

## Context

The ask-spending chat answered "How many times have I eaten Indian in the last
2 months?" with 2 receipts. Nothing in the data says what kind of place a
merchant is, so the agent guessed from merchant names, over partial tool
results (row caps). The answer is incomplete and can change between runs.

We want to classify receipts by attributes such as cuisine or origin
("Indian dining", "Indian groceries"), and the design must hold up if the app
is offered publicly: many households, many receipts, LLM cost that does not
grow per receipt.

Constraints:
- Don't add attribute columns to `receipts` that only apply to some receipt types.
- RLS stays the privacy boundary (household visibility via `is_visible_receipt`).
- Categories are text today; built-ins are fixed, households can add and
  **rename** custom ones (`rename_household_category`, multiuser-18).
- The iOS app is not changed by this work.

## Decision

1. **A tag is a dimension separate from the category.** The tag says what
   kind of place it is (kind `origin`: indian, chinese, japanese…). The
   receipt's category says what was bought there. A question combines the two:
   Indian + Food & Dining = "Indian dining"; Indian + Groceries = "Indian
   groceries"; Indian alone = everything Indian.
2. **Tags attach to a merchant + category pair, not to receipts.** Cuisine
   and origin are facts about the place, so they are classified once per pair
   and shared by every receipt from that pair. Multi-category stores work
   naturally: Mustafa is Indian for Groceries, untagged for Electronics.
3. **Three scopes, most specific wins:** a receipt-level tag beats a household
   override, which beats a global fact. Within a scope, an exact category
   beats a wildcard (`category IS NULL`).
4. **Resolved at query time by a view** (`receipt_effective_tags`), never
   copied onto receipts. Correcting a receipt's category automatically changes
   its tags.
5. **A global merchant directory** (`merchants` + `merchant_aliases`) gives
   receipts a `merchant_id`. Merchants and global tags hold business names
   only, never who spent what.

## Schema (sketch, to be finalised in the migration)

```sql
-- Global merchant directory
create table public.merchants (
  id uuid primary key default gen_random_uuid(),
  normalized_name text not null unique,          -- e.g. 'saravana bhavan'
  display_name text not null,
  created_at timestamptz not null default now()
);
create table public.merchant_aliases (
  alias text primary key,                         -- normalised raw name, e.g. 'saravana bhavan pte ltd'
  merchant_id uuid not null references public.merchants(id) on delete cascade
);

-- Tag vocabulary: global (household_id null) + household-defined
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                              -- 'origin' first; more kinds later
  slug text not null,                              -- 'indian'
  label text not null,                             -- 'Indian'
  household_id uuid references public.households(id) on delete cascade,
  unique nulls not distinct (household_id, kind, slug)
);

-- The core decision: tags per merchant + category, per scope
create table public.merchant_category_tags (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  category text,                                   -- null = any category
  tag_id uuid not null references public.tags(id) on delete cascade,
  household_id uuid references public.households(id) on delete cascade,  -- null = global
  source text not null check (source in ('classifier','user','backfill','admin')),
  confidence numeric,                              -- classifier only
  model_version text,                              -- classifier only
  created_at timestamptz not null default now(),
  unique nulls not distinct (merchant_id, category, tag_id, household_id),
  -- global facts may only use built-in categories (custom ones can be renamed)
  constraint global_uses_builtin_category check (
    household_id is not null or category is null or category in (
      'Groceries','Food & Dining','Electronics','Clothing','Entertainment','Fuel',
      'EV Charging','Utilities','Travel','Commute','Health','Home','Subscriptions',
      'Services','Local Transfer','Credit Card Bill Payment','ATM Cash Withdrawal','Miscellaneous'))
);
create index on public.merchant_category_tags (tag_id, category, merchant_id);

-- Receipt-only tags and overrides ("reimbursable", or "not Indian" for one receipt)
create table public.receipt_tags (
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  household_id uuid not null,                      -- copied from the receipt, for cheap RLS
  negated boolean not null default false,          -- an override can remove an inherited tag
  source text not null,
  created_at timestamptz not null default now(),
  primary key (receipt_id, tag_id)
);
create index on public.receipt_tags (tag_id, receipt_id);

-- The one change to receipts: every receipt has a merchant, so this is not a sparse column
alter table public.receipts add column merchant_id uuid references public.merchants(id);
```

`receipts.merchant` (the text) stays as the display value; `merchant_id` is
the resolved link and may be null until resolved.

## Resolution: `receipt_effective_tags` (security_invoker view)

For each receipt, candidate tags come from:

| Precedence | Source | Match |
|---|---|---|
| 1 | `receipt_tags` | `receipt_id` (a `negated` row removes the tag) |
| 2 | `merchant_category_tags`, household | `merchant_id`, `household_id = receipt.household_id`, `category = receipt.category` |
| 3 | same, household | … `category is null` |
| 4 | `merchant_category_tags`, global | `merchant_id`, `household_id is null`, `category = receipt.category` |
| 5 | same, global | … `category is null` |

Per (receipt, tag kind) the highest-precedence row wins (`distinct on … order
by precedence`). The receipt's category uses the same fallback as `ask_receipts`
(column, then `raw_ocr_json.category`). The view is security_invoker over
`ask_receipts`, so receipt RLS applies unchanged.

## RLS

- `merchants`, `merchant_aliases`, global `tags`, global `merchant_category_tags`:
  readable by `authenticated`; **writable only by the service role**
  (classifier, backfill). Users never write global facts directly.
- Household rows (`tags`, `merchant_category_tags`, `receipt_tags`):
  read/write when `household_id in (select public.current_household_ids())`.
  `household_id` is stored on the row so policies never join back to
  `receipts` per row. Policies use `(select auth.uid())` so it is evaluated
  once per query.
- `receipt_tags` insert also checks the receipt is visible to the caller.

## Classification flow

At ingestion (all three pipelines), **never blocking the receipt insert**:

1. Normalise the raw merchant name (lowercase, strip suffixes like "pte ltd",
   branch/location words, punctuation) → look up `merchant_aliases`.
2. Hit: set `receipts.merchant_id`. If the (merchant, category) pair has a
   global tag decision already, done: **no LLM call**.
3. Miss: enqueue the pair. A background job (pg_cron, same pattern as
   process-sms-inbox) batches unseen pairs and makes **one LLM call per
   batch**. Input: merchant names, categories, sample line items. Output: tag
   slug or null ("unknown" is a valid answer; never guess).
4. The job writes global `merchant_category_tags` rows (`source='classifier'`,
   confidence, model_version) and creates merchants/aliases as needed.

LLM cost grows with **distinct merchant + category pairs**, not receipts.

**User corrections:** changing an origin in the receipt editor writes a
*household* override for that merchant + category (or a `receipt_tags` row
when the user picks "only this receipt"). This parallels the existing
`receipt_correction_rules` learning. For a public product, household overrides
that agree across many households can be promoted to global through a review
step (not automatic).

## Categories are renamable

`rename_household_category` already cascades to `receipts` and
`receipt_correction_rules`. It must also update
`merchant_category_tags.category` for that household. Global rows can't be
affected, because they may only reference built-in categories (check constraint).

## Agent change

New tool `spending_by_tag(tag, category?, from, to)` over a new
`ask_spending_by_tag` RPC on `receipt_effective_tags`:

| Question | Call |
|---|---|
| How many times did I eat Indian? | `tag: 'indian', category: 'Food & Dining'` |
| How much on Indian groceries? | `tag: 'indian', category: 'Groceries'` |
| Everything Indian last month | `tag: 'indian'` |

## Rollout

1. Migration: tables, RLS, view, `receipts.merchant_id`, seed `origin` tags,
   rename cascade.
2. Backfill: normalise and resolve merchants for existing receipts; classify
   distinct (merchant, category) pairs in batches (script in `notebooks/`).
3. Ingestion: resolve `merchant_id` in all three pipelines (shared logic
   duplicated by design; see CLAUDE.md on drift), enqueue unseen pairs;
   classifier job.
4. Webapp: origin shown and editable on receipts (writes household override).
5. Agent: `spending_by_tag` tool; measure the "Indian" question before/after
   in LangSmith.

## Consequences

**Good**
- Exact, repeatable answers for "Indian dining / groceries", computed by Postgres.
- Classification cost is per merchant + category pair, amortised across all households.
- Category corrections flow through to tags automatically.
- New tag kinds (e.g. `dietary`, `channel: delivery`) need no schema change.

**Costs and risks**
- **Merchant name matching quality** decides everything. Version 1 is
  normalisation + aliases; fuzzy matching (pg_trgm) or a review queue may
  follow. Mis-merged merchants would share tags wrongly.
- The view's precedence query is more complex than a column read. It needs
  the `(tag_id, category, merchant_id)` index and testing at volume.
- Categories as text remain a latent issue; a categories table with ids is the
  long-term model, deferred because `receipts.category` is text across three
  pipelines and the iOS app.
- One new column on `receipts` (`merchant_id`), justified because it applies
  to every receipt.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| Tag columns on `receipts` | Sparse columns; rejected by constraint |
| `receipt_tags` only (tag every receipt) | LLM cost and drift per receipt; same restaurant labelled inconsistently |
| Tags keyed by merchant only | Can't express multi-category stores (Mustafa groceries vs electronics) or "Indian dining" vs "Indian groceries" |
| Per-domain extension tables (`receipt_dining`) | New table per domain; rigid for user-defined tags |
| JSONB attributes table | Weak constraints, heavier indexes, harder plans for a frequently filtered field |

## Open questions
- Tag kinds beyond `origin` for v1? (Proposal: `origin` only.)
- Should a household override ever propagate to other households automatically? (Proposal: no; review-gated promotion only.)
- Merchant normalisation rules for SMS alerts, which often truncate names (e.g. "SARAVANA BHAV").
