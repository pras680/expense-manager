#!/usr/bin/env python3
"""
Jev feasibility stub — ADR-0003 (category review flags) and ADR-0001 (tagging).

Answers one question before any production code is written:
  "Does Jev classify OUR receipts well enough, with trustworthy confidence?"

It is a test harness, not app code. It READS receipts (never writes), sends a
small amount of text per receipt to TypeSafe's API, and writes results to
notebooks/jev_out/ (gitignored: it contains real merchant names).

Commands
  probe        One request, prints Jev's raw JSON. Run this FIRST: the launch
               coverage does not document the response shape, and the parser
               below guesses it.
  categories   Ask Jev the category of reviewed receipts (your categories are
               the ground truth) -> accuracy, calibration, flag simulation.
  tags         Ask Jev origin / venue_type for your top Food & Dining and
               Groceries merchants -> CSV for you to mark right/wrong.
  tags-score   Score that CSV after you've filled in the expected_* columns.
  rescore      Re-parse saved raw responses (after fixing the parser) without
               new API calls.

Setup (notebooks/.env, alongside DATABASE_URL):
  TYPESAFE_API_KEY=...            # never commit, never paste in chat
  JEV_API_URL=https://api.typesafe.ai/v1/systemone   (default)
  JEV_MODEL=jev-latest                               (default)

Examples
  python jev_feasibility.py --out jev_out_r2 categories --include-raw-text --with-corrections
  python jev_feasibility.py --out jev_out_r2c categories --include-raw-text --with-corrections --include-comments
  python jev_feasibility.py probe
  python jev_feasibility.py categories --dry-run --limit 5
  python jev_feasibility.py categories --limit 200
  python jev_feasibility.py tags --limit 60
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import random
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:  # dotenv is in requirements.txt; tolerate its absence
    pass

API_URL = os.environ.get("JEV_API_URL", "https://api.typesafe.ai/v1/systemone")
MODEL = os.environ.get("JEV_MODEL", "jev-latest")
PRICE_PER_M_INPUT = 0.042  # USD per million input tokens, launch pricing (Sep 2026)
OUT = Path(__file__).with_name("jev_out")

# Mirrors webapp/src/lib/categories.ts EXPENSE_CATEGORIES.
BUILTIN_CATEGORIES = [
    "Groceries", "Food & Dining", "Electronics", "Clothing", "Entertainment", "Fuel",
    "EV Charging", "Utilities", "Travel", "Commute", "Health", "Home", "Subscriptions",
    "Services", "Local Transfer", "Credit Card Bill Payment", "ATM Cash Withdrawal", "Miscellaneous",
]

ORIGINS = ["indian", "chinese", "japanese", "korean", "thai", "malay", "indonesian", "vietnamese",
           "western", "italian", "middle_eastern", "mexican", "mixed_or_local", "unknown"]
VENUE_TYPES = {
    "Food & Dining": ["bakery", "cafe", "hawker", "restaurant", "fast_food", "dessert",
                      "bar", "food_delivery", "other", "unknown"],
    "Groceries": ["supermarket", "specialty_or_ethnic_grocery", "wet_market", "online_grocery",
                  "convenience_store", "other", "unknown"],
}

CONF_BUCKETS = [0.0, 0.5, 0.7, 0.8, 0.9, 0.95, 1.0001]

# Optional one-line hints per built-in category (Jev `choice` criteria values).
# Kept in line with the Travel/Commute split and transfer semantics in CLAUDE.md.
CATEGORY_HINTS = {
    "Groceries": "Supermarkets, grocery stores, produce, household grocery items, wet markets, online grocery",
    "Food & Dining": "Restaurants, cafes, hawker stalls, bakeries, food delivery, prepared food",
    "Electronics": "Computers, phones, appliances, accessories, tech stores",
    "Clothing": "Apparel, shoes, laundry, fashion stores",
    "Entertainment": "Movies, games, events, books, music, leisure",
    "Fuel": "Petrol stations and fuel purchases",
    "EV Charging": "Electric vehicle charging sessions or charging networks (not household electricity)",
    "Utilities": "Household power, water, gas, internet, phone bills",
    "Travel": "Flights, hotels, car rentals, trip and holiday bookings (not local rides or transit)",
    "Commute": "Local getting-around: rideshare/taxi (Grab, Gojek, TADA, CDG), bus/MRT, SimplyGo/EZ-Link, parking, ERP, incl. rides to the airport",
    "Health": "Pharmacy, medical, dental, fitness, personal care",
    "Home": "Hardware, furniture, home improvement, garden supplies",
    "Subscriptions": "Recurring digital services or memberships",
    "Services": "A specific service rendered: repair, cleaning, tuition, salon, consultation, maintenance",
    "Local Transfer": "Money moved between bank accounts or to a person (PayNow, PayLah, FAST), no goods or service documented",
    "Credit Card Bill Payment": "Paying off a credit card statement or balance, not a purchase",
    "ATM Cash Withdrawal": "Cash withdrawn from an ATM",
    "Miscellaneous": "Only when nothing else fits",
}

CATEGORY_INSTRUCTIONS = "Which spending category does this purchase belong to, judging by the merchant and items?"
ORIGIN_INSTRUCTIONS = "What cuisine or cultural origin is this merchant known for?"
VENUE_INSTRUCTIONS = "What kind of venue is this merchant?"


def choice_q(instructions: str, options: list[str], hints: dict[str, str] | None = None) -> dict:
    """
    A Jev `choice` question: {type, instructions, criteria}. `criteria` maps each
    option to a short description or null (no `options` list; the 422 on
    questions.<name>.choice.criteria was exactly this).
    """
    hints = hints or {}
    return {"type": "choice", "instructions": instructions,
            "criteria": {o: hints.get(o) for o in options}}


def q_options(q: dict) -> list[str]:
    return list(q["criteria"])


# --------------------------------------------------------------------------- Jev API

def jev_call(state: str, questions: dict, timeout: float = 30.0) -> tuple[dict, float]:
    """One request. Returns (raw JSON, latency seconds). Retries once on 429/5xx."""
    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        sys.exit("TYPESAFE_API_KEY is not set (put it in notebooks/.env).")
    body = {"model": MODEL, "state": state, "questions": questions}
    for attempt in (1, 2):
        t0 = time.perf_counter()
        resp = requests.post(API_URL, headers={"Authorization": f"Bearer {key}"}, json=body, timeout=timeout)
        dt = time.perf_counter() - t0
        if resp.status_code in (429, 500, 502, 503) and attempt == 1:
            time.sleep(float(resp.headers.get("retry-after", 2)))
            continue
        if not resp.ok:
            raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:300]}")
        return resp.json(), dt
    raise RuntimeError("unreachable")


def extract_probs(raw: dict, question: str, options: list[str]) -> dict[str, float]:
    """
    Pull {option: probability} for one question out of Jev's response.

    The response schema isn't in the launch coverage, so this tries the likely
    shapes. If none match, it raises with the raw JSON: run `probe`, look at
    the shape, adjust here, then `rescore` (no new API calls needed).
    """
    container = raw
    for key in ("decisions", "answers", "results", "outputs", "data"):
        if isinstance(raw.get(key), dict):
            container = raw[key]
            break
    q = container.get(question) if isinstance(container, dict) else None
    if q is None:
        raise ValueError(f"no '{question}' in response: {json.dumps(raw)[:400]}")

    def norm(d: dict[str, float]) -> dict[str, float]:
        d = {str(k): float(v) for k, v in d.items() if v is not None}
        return d

    if isinstance(q, dict):
        for key in ("probabilities", "probs", "distribution", "scores", "options"):
            v = q.get(key)
            if isinstance(v, dict):
                return norm(v)
            if isinstance(v, list):
                return norm({(i.get("option") or i.get("label") or i.get("value") or i.get("name")):
                             (i.get("probability") or i.get("p") or i.get("prob") or i.get("score"))
                             for i in v if isinstance(i, dict)})
        if "choice" in q and "confidence" in q:  # documented choice answer, no probabilities
            return {str(q["choice"]): float(q["confidence"])}
        if "value" in q and ("confidence" in q or "probability" in q):
            return {str(q["value"]): float(q.get("confidence", q.get("probability")))}
        if all(isinstance(v, (int, float)) for v in q.values()) and set(q) <= set(options) | {"unknown"}:
            return norm(q)
    if isinstance(q, list):
        return norm({(i.get("option") or i.get("label") or i.get("value")):
                     (i.get("probability") or i.get("p") or i.get("prob")) for i in q if isinstance(i, dict)})
    raise ValueError(f"unrecognised shape for '{question}': {json.dumps(q)[:400]}")


def top(probs: dict[str, float]) -> tuple[str | None, float]:
    if not probs:
        return None, 0.0
    k = max(probs, key=probs.get)
    return k, probs[k]


# --------------------------------------------------------------------------- data

def db():
    import psycopg2  # only needed for commands that read the database
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("DATABASE_URL is not set (notebooks/.env).")
    return psycopg2.connect(url)


def item_descriptions(line_items) -> list[str]:
    if isinstance(line_items, str):
        try:
            line_items = json.loads(line_items)
        except ValueError:
            return []
    if not isinstance(line_items, list):
        return []
    return [str(i.get("description")) for i in line_items if isinstance(i, dict) and i.get("description")]


def load_reviewed_receipts(limit: int, household_id: str | None, seed: float) -> list[dict]:
    """Reviewed receipts = a person confirmed or corrected them, so their category is ground truth."""
    sql = """
        select r.id::text, r.household_id::text, r.merchant, r.source,
               coalesce(nullif(r.category, ''), nullif(r.raw_ocr_json::jsonb->>'category', '')) as category,
               r.raw_ocr_json::jsonb->'line_items' as line_items,
               r.raw_ocr_json::jsonb->>'raw_text' as raw_text,
               r.comment
        from public.receipts r
        where r.reviewed_at is not null
          and r.merchant is not null
          and (%(hh)s::uuid is null or r.household_id = %(hh)s::uuid)
        order by random()
        limit %(limit)s
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute("select setseed(%s)", (seed,))  # same sample on every run
        cur.execute(sql, {"hh": household_id, "limit": limit})
        cols = [c.name for c in cur.description]
        rows = [dict(zip(cols, r)) for r in cur.fetchall()]
        cur.execute("select household_id::text, name from public.household_categories")
        custom: dict[str, list[str]] = {}
        for hh, name in cur.fetchall():
            custom.setdefault(hh, []).append(name)
        # Learned corrections, read with a plain SELECT. NEVER call
        # match_correction_rules(): it bumps use_count (it writes), and this
        # harness must stay read-only. Matching is re-done in match_rules().
        cur.execute("""
            select household_id::text, merchant_keyword, corrected_merchant, corrected_category, note, learned_at
            from public.receipt_correction_rules
        """)
        rules: dict[str, list[dict]] = {}
        for hh, kw, cm, cc, note, learned in cur.fetchall():
            rules.setdefault(hh, []).append({"keyword": kw, "merchant": cm, "category": cc, "note": note,
                                             "learned_at": learned.isoformat() if learned else ""})
    for r in rows:
        r["items"] = item_descriptions(r.pop("line_items"))
        r["custom_categories"] = custom.get(r["household_id"], [])
        r["rules"] = rules.get(r["household_id"], [])
    return [r for r in rows if r["category"]]


def load_csv(path: str) -> list[dict]:
    """Offline input: columns id, merchant, source, category, items ('|'-separated), raw_text, custom_categories ('|')."""
    rows = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            r["items"] = [s for s in (r.get("items") or "").split("|") if s]
            r["custom_categories"] = [s for s in (r.get("custom_categories") or "").split("|") if s]
            r["rules"] = json.loads(r["rules"]) if r.get("rules") else []
            rows.append(r)
    return rows


def match_rules(r: dict) -> list[dict]:
    """
    Same matching as public.match_correction_rules (multiuser-14): the rule's
    merchant_keyword appears in the receipt's text, newest first, at most 12.
    Falls back to the merchant name when a receipt has no stored text.
    """
    haystack = (r.get("raw_text") or r.get("merchant") or "").lower()
    hits = [x for x in r.get("rules", []) if x.get("keyword") and x["keyword"].lower() in haystack]
    return sorted(hits, key=lambda x: x.get("learned_at") or "", reverse=True)[:12]


def receipt_state(r: dict, include_raw_text: bool, with_corrections: bool = False,
                  include_comments: bool = False) -> str:
    lines = [f"Merchant: {r['merchant']}", f"Arrived via: {r.get('source') or 'unknown'}"]
    if r["items"]:
        lines.append("Items: " + "; ".join(r["items"][:15]))
    if include_raw_text and r.get("raw_text"):
        lines.append("Receipt text:\n" + r["raw_text"][:1200])
    if with_corrections:
        for rule in match_rules(r):
            parts = [f"merchant keyword '{rule['keyword']}'"]
            if rule.get("category"):
                parts.append(f"category {rule['category']}")
            if rule.get("merchant"):
                parts.append(f"merchant name {rule['merchant']}")
            if rule.get("note"):
                parts.append(f"note: {rule['note']}")
            lines.append("This household previously corrected: " + "; ".join(parts))
    if include_comments and r.get("comment"):
        lines.append("Comment on this receipt: " + str(r["comment"])[:300])
    return "\n".join(lines)


# --------------------------------------------------------------------------- commands

def cmd_probe(args):
    state = "Merchant: Saravana Bhavan\nArrived via: sms\nItems: masala dosa; filter coffee"
    questions = {
        "category": choice_q(CATEGORY_INSTRUCTIONS, BUILTIN_CATEGORIES, CATEGORY_HINTS),
        "origin": choice_q(ORIGIN_INSTRUCTIONS, ORIGINS),
    }
    print("REQUEST →", json.dumps({"model": MODEL, "state": state, "questions": questions}, indent=2))
    raw, dt = jev_call(state, questions)
    print(f"\nRESPONSE ({dt * 1000:.0f} ms) →\n{json.dumps(raw, indent=2)}")
    for qn, opts in (("category", BUILTIN_CATEGORIES), ("origin", ORIGINS)):
        try:
            print(f"\nparsed {qn}: top = {top(extract_probs(raw, qn, opts))}")
        except ValueError as e:
            print(f"\nparser could not read {qn}: {e}\n→ adjust extract_probs() to this shape.")


def cmd_categories(args):
    rows = load_csv(args.from_csv) if args.from_csv else load_reviewed_receipts(args.limit, args.household_id, args.seed)
    if args.exclude_transfers:
        rows = [r for r in rows if r["category"] not in ("Local Transfer", "Credit Card Bill Payment")]
    rows = rows[: args.limit]
    sent = ["merchant", "source", "line items"]
    if args.include_raw_text:
        sent.append("receipt text (first 1,200 chars)")
    if args.with_corrections:
        sent.append("matching learned corrections")
    if args.include_comments:
        sent.append("receipt comment (UPPER BOUND: usually the parser's own reasoning)")
    config = {"include_raw_text": args.include_raw_text, "with_corrections": args.with_corrections,
              "include_comments": args.include_comments, "seed": args.seed, "limit": args.limit}
    print(f"{len(rows)} reviewed receipts. Sending per receipt: {', '.join(sent)}.")
    if args.with_corrections:
        print(f"{sum(bool(match_rules(r)) for r in rows)} of them match at least one learned correction.")

    def request_for(r):
        options = BUILTIN_CATEGORIES + [c for c in r["custom_categories"] if c not in BUILTIN_CATEGORIES]
        hints = {**CATEGORY_HINTS, **{c: c for c in r["custom_categories"] if c not in CATEGORY_HINTS}}
        state = receipt_state(r, args.include_raw_text, args.with_corrections, args.include_comments)
        return state, {"category": choice_q(CATEGORY_INSTRUCTIONS, options, hints)}

    if args.dry_run:
        for r in rows[:3]:
            s, q = request_for(r)
            print("\n--- would send ---\n" + json.dumps({"model": MODEL, "state": s, "questions": q}, indent=2))
        return

    OUT.mkdir(exist_ok=True)
    raw_path = OUT / "categories_raw.jsonl"

    def work(r):
        s, q = request_for(r)
        try:
            raw, dt = jev_call(s, q)
            return {"row": r, "state_chars": len(s), "raw": raw, "latency": dt, "options": q_options(q["category"]),
                    "rule_matched": bool(match_rules(r)), "has_comment": bool(r.get("comment")), "config": config}
        except Exception as e:  # noqa: BLE001 — record and continue
            return {"row": r, "state_chars": len(s), "error": str(e), "config": config}

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        results = list(pool.map(work, rows))
    with raw_path.open("w") as f:
        for res in results:
            row = {k: v for k, v in res["row"].items() if k != "rules"}  # rules can be large; matched ones are in state
            f.write(json.dumps({**res, "row": row}, default=str) + "\n")
    print(f"raw responses → {raw_path}")
    score_categories(results)


def cmd_rescore(args):
    path = OUT / "categories_raw.jsonl"
    results = [json.loads(l) for l in path.open()]
    score_categories(results)


def score_categories(results: list[dict]):
    scored, errors, latencies, chars, tokens, tokens_n = [], 0, [], 0, 0, 0
    config = next((r["config"] for r in results if r.get("config")), {})
    for res in results:
        chars += res.get("state_chars", 0)
        usage = (res.get("raw") or {}).get("usage") or {}
        if isinstance(usage.get("input_tokens"), (int, float)):
            tokens += usage["input_tokens"]
            tokens_n += 1
        if "error" in res:
            errors += 1
            continue
        latencies.append(res["latency"])
        try:
            probs = extract_probs(res["raw"], "category", res["options"])
        except ValueError as e:
            errors += 1
            if errors <= 3:
                print(f"parse error: {e}")
            continue
        guess, conf = top(probs)
        truth = res["row"]["category"]
        scored.append({"id": res["row"]["id"], "merchant": res["row"]["merchant"], "source": res["row"].get("source"),
                       "truth": truth, "jev": guess, "confidence": round(conf, 4), "correct": guess == truth,
                       "rule_matched": res.get("rule_matched", False), "has_comment": res.get("has_comment", False),
                       "latency_ms": round(res["latency"] * 1000)})

    OUT.mkdir(exist_ok=True)
    if scored:
        with (OUT / "categories_results.csv").open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(scored[0]))
            w.writeheader()
            w.writerows(scored)

    lines = ["# Jev feasibility: categories", ""]
    n = len(scored)
    if n == 0:
        lines.append(f"No scorable results ({errors} errors). Run `probe` and check the response shape.")
        report(lines)
        return
    acc = sum(s["correct"] for s in scored) / n
    if tokens_n:  # Jev's own count: includes instructions, criteria and option names
        tok_total, tok_note = tokens, "reported by Jev"
    else:
        tok_total, tok_note = chars / 4, "estimated as chars/4; Jev reported no usage"
    flags = [k for k in ("include_raw_text", "with_corrections", "include_comments") if config.get(k)]
    lines += [f"- Run: {', '.join(flags) or 'name + items only'} (seed {config.get('seed', '?')})"]
    if config.get("include_comments"):
        lines += ["- ⚠️ **Upper bound.** Comments are usually pre-filled from the parser's own derivation note, "
                  "which often names the category. Agreement here partly measures copying, not an independent second opinion."]
    lines += [f"- Receipts scored: **{n}** (errors: {errors})",
              f"- Top-1 accuracy vs your verified categories: **{acc:.1%}** (ADR-0003 starting bar: 85%)",
              f"- Latency: p50 {statistics.median(latencies) * 1000:.0f} ms, "
              f"p95 {sorted(latencies)[int(0.95 * (len(latencies) - 1))] * 1000:.0f} ms",
              f"- Input {tok_total:,.0f} tokens ({tok_note}) → ≈ ${tok_total / 1e6 * PRICE_PER_M_INPUT:.4f} "
              f"(≈ ${tok_total / max(tokens_n or n, 1) / 1e6 * PRICE_PER_M_INPUT * 1000:.4f} per 1,000 receipts)", ""]

    def split(label: str, key: str, yes: str, no: str):
        out = [f"## Accuracy {label}", "", "| Group | Receipts | Accuracy |", "|---|---|---|"]
        for name, val in ((yes, True), (no, False)):
            b = [s for s in scored if bool(s[key]) == val]
            if b:
                out.append(f"| {name} | {len(b)} | {sum(x['correct'] for x in b) / len(b):.0%} |")
        return out + [""]

    if config.get("with_corrections"):
        lines += split("with vs without a learned correction", "rule_matched",
                       "Matches a correction (Jev can lean on your rule)", "No matching correction (Jev's own judgement)")
    if config.get("include_comments"):
        lines += split("with vs without a comment", "has_comment", "Has a comment", "No comment")

    lines += ["## Calibration (is a 0.9 right ~90% of the time?)", "",
              "| Confidence | Receipts | Avg confidence | Accuracy |", "|---|---|---|---|"]
    for lo, hi in zip(CONF_BUCKETS, CONF_BUCKETS[1:]):
        b = [s for s in scored if lo <= s["confidence"] < hi]
        if b:
            lines.append(f"| {lo:.2f}–{min(hi, 1):.2f} | {len(b)} | {statistics.mean(s['confidence'] for s in b):.2f} "
                         f"| {sum(s['correct'] for s in b) / len(b):.0%} |")

    # Flag policy simulation (ADR-0003). On verified receipts every flag is a
    # FALSE alarm. To estimate how many REAL errors would be caught, plant a
    # wrong category on each receipt (what a bad parser would have saved) and
    # check whether the policy would flag it. No extra API calls.
    rng = random.Random(7)
    lines += ["", "## Flag policy simulation", "",
              "Policy: flag when Jev disagrees with the saved category at confidence ≥ T, or Jev's confidence < 0.5.", "",
              "| T | False alarms on correct receipts | Planted errors caught |", "|---|---|---|"]
    for t in (0.6, 0.7, 0.8, 0.9, 0.95):
        false_alarm = sum((s["jev"] != s["truth"] and s["confidence"] >= t) or s["confidence"] < 0.5 for s in scored) / n
        caught = 0
        for s in scored:
            planted = rng.choice([c for c in BUILTIN_CATEGORIES if c != s["truth"]])
            caught += (s["jev"] != planted and s["confidence"] >= t) or s["confidence"] < 0.5
        lines.append(f"| {t:.2f} | {false_alarm:.1%} | {caught / n:.1%} |")

    lines += ["", "## Accuracy by source", "", "| Source | Receipts | Accuracy |", "|---|---|---|"]
    for src in sorted({s["source"] or "unknown" for s in scored}):
        b = [s for s in scored if (s["source"] or "unknown") == src]
        lines.append(f"| {src} | {len(b)} | {sum(x['correct'] for x in b) / len(b):.0%} |")

    misses: dict[tuple[str, str], int] = {}
    for s in scored:
        if not s["correct"]:
            misses[(s["truth"], s["jev"])] = misses.get((s["truth"], s["jev"]), 0) + 1
    if misses:
        lines += ["", "## Most common confusions", "", "| Your category | Jev said | Count |", "|---|---|---|"]
        for (t, j), c in sorted(misses.items(), key=lambda kv: -kv[1])[:10]:
            lines.append(f"| {t} | {j} | {c} |")
    lines += ["", f"Per-receipt results: `{OUT.name}/categories_results.csv`. Raw responses: `{OUT.name}/categories_raw.jsonl`."]
    report(lines)


def report(lines: list[str], name: str = "categories_summary.md"):
    text = "\n".join(lines)
    print("\n" + text)
    OUT.mkdir(exist_ok=True)
    (OUT / name).write_text(text + "\n")
    print(f"\nsummary → {OUT / name}")


def cmd_tags(args):
    sql = """
        select r.merchant,
               coalesce(nullif(r.category, ''), nullif(r.raw_ocr_json::jsonb->>'category', '')) as category,
               count(*) as receipts,
               (array_agg(r.raw_ocr_json::jsonb->'line_items' order by r.date desc))[1:3] as item_samples
        from public.receipts r
        where r.merchant is not null
        group by 1, 2
        order by 3 desc
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(sql)
        rows = [{"merchant": m, "category": c, "receipts": n,
                 "items": [d for li in (s or []) for d in item_descriptions(li)][:10]}
                for m, c, n, s in cur.fetchall() if c in VENUE_TYPES][: args.limit]
    print(f"{len(rows)} merchant + category pairs (Food & Dining, Groceries).")
    if args.dry_run:
        print(json.dumps(rows[:3], indent=2))
        return

    def work(r):
        state = f"Merchant: {r['merchant']}\nCategory: {r['category']}"
        if r["items"]:
            state += "\nItems bought there: " + "; ".join(r["items"])
        questions = {"origin": choice_q(ORIGIN_INSTRUCTIONS, ORIGINS),
                     "venue_type": choice_q(VENUE_INSTRUCTIONS, VENUE_TYPES[r["category"]])}
        try:
            raw, dt = jev_call(state, questions)
            o, oc = top(extract_probs(raw, "origin", ORIGINS))
            v, vc = top(extract_probs(raw, "venue_type", VENUE_TYPES[r["category"]]))
            return {**r, "jev_origin": o, "origin_conf": round(oc, 3), "jev_venue_type": v,
                    "venue_conf": round(vc, 3), "latency_ms": round(dt * 1000)}
        except Exception as e:  # noqa: BLE001
            return {**r, "error": str(e)[:200]}

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        out = list(pool.map(work, rows))
    OUT.mkdir(exist_ok=True)
    path = OUT / "tags_review.csv"
    fields = ["merchant", "category", "receipts", "jev_origin", "origin_conf", "expected_origin",
              "jev_venue_type", "venue_conf", "expected_venue_type", "latency_ms", "error", "items"]
    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in out:
            w.writerow({**r, "items": "; ".join(r.get("items", []))})
    print(f"→ {path}\nFill expected_origin / expected_venue_type (copy Jev's value when it's right), "
          f"then run: python jev_feasibility.py tags-score")


def cmd_tags_score(args):
    path = OUT / "tags_review.csv"
    rows = list(csv.DictReader(path.open()))
    lines = ["# Jev feasibility: merchant tags", ""]
    for field, exp, conf in (("jev_origin", "expected_origin", "origin_conf"),
                             ("jev_venue_type", "expected_venue_type", "venue_conf")):
        marked = [r for r in rows if r.get(exp)]
        if not marked:
            lines.append(f"- {field}: no rows marked yet")
            continue
        acc = sum(r[field] == r[exp] for r in marked) / len(marked)
        hi = [r for r in marked if float(r[conf] or 0) >= 0.8]
        hi_text = f"{sum(r[field] == r[exp] for r in hi) / len(hi):.0%} of {len(hi)}" if hi else "n/a (none)"
        lines.append(f"- {field}: **{acc:.0%}** of {len(marked)} marked; at confidence ≥ 0.8: "
                     f"{hi_text} (these would be auto-applied under ADR-0001)")
    report(lines, "tags_summary.md")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("probe")
    c = sub.add_parser("categories")
    c.add_argument("--limit", type=int, default=200)
    c.add_argument("--household-id")
    c.add_argument("--seed", type=float, default=0.42, help="same random sample on every run")
    c.add_argument("--include-raw-text", action="store_true", help="also send the first 1,200 chars of receipt text")
    c.add_argument("--with-corrections", action="store_true",
                   help="also send the household's learned corrections that match the receipt (as parse-receipt gets them)")
    c.add_argument("--include-comments", action="store_true",
                   help="also send the receipt comment (upper bound: comments usually hold the parser's own reasoning)")
    c.add_argument("--exclude-transfers", action="store_true")
    c.add_argument("--from-csv", help="offline input instead of the database")
    c.add_argument("--concurrency", type=int, default=4)
    c.add_argument("--dry-run", action="store_true", help="print sample requests, call nothing")
    t = sub.add_parser("tags")
    t.add_argument("--limit", type=int, default=60)
    t.add_argument("--concurrency", type=int, default=4)
    t.add_argument("--dry-run", action="store_true")
    sub.add_parser("tags-score")
    sub.add_parser("rescore")
    p.add_argument("--out", default="jev_out", help="output folder inside notebooks/ (default jev_out)")
    args = p.parse_args()
    global OUT
    OUT = Path(__file__).with_name(args.out)
    {"probe": cmd_probe, "categories": cmd_categories, "tags": cmd_tags,
     "tags-score": cmd_tags_score, "rescore": cmd_rescore}[args.cmd](args)


if __name__ == "__main__":
    main()
