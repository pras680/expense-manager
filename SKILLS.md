# Skills Demonstrated — Expense Manager

A full-stack, multi-platform expense tracker (React/TypeScript PWA + Supabase backend + iOS SwiftUI client) built solo. Highlights for a LinkedIn summary:

## System & Backend Design
- Designed a multi-tenant data model (households, shared visibility, RLS-enforced privacy boundaries) in Postgres with trigger-based ownership stamping.
- Built serverless ingestion pipelines (Supabase Edge Functions / Deno) with cron-driven batch processing, retry-budget accounting, and fail-open error handling for resilience.
- Implemented idempotent, cross-source duplicate detection and record-merging logic (richness-ranked sources, conflict resolution rules) across three independent ingestion paths.

## AI / LLM Integration
- Integrated a vision-capable LLM (Groq) for receipt parsing from images and raw text, with JSON-mode structured extraction.
- Designed prompt-engineering workarounds for model quirks (sign-based direction signaling instead of boolean flags) validated through live testing.
- Built a self-improving "learned correction" system where user edits feed back into household-scoped classification rules.
- Implemented LLM quota/rate-limit observability (parsing provider headers, surfacing live quota state in the UI).

## Security
- Implemented real authentication (Supabase Auth) with invite-gated registration and timing-safe secret comparison.
- Enforced row-level security policies as the actual privacy boundary (not client-side gating).
- Locked down public object storage (signed URLs, auth-gated uploads) after identifying an open-read/open-write vulnerability.
- Managed secrets via a vault/service-role separation (OAuth refresh tokens never in client-readable tables).

## Frontend Engineering
- Built a mobile-first PWA (React + Vite + TypeScript + Tailwind) with offline-aware caching (Workbox) and selective code-splitting to minimize install-time payload.
- Handled cross-platform file input quirks (iOS Safari camera/file-picker behavior).

## Cross-Platform Architecture
- Maintained business-logic parity (currency conversion, categorization, parsing rules) across three independently deployed runtimes (web, iOS, Edge Functions) without a shared code layer.
- Designed schema migrations for backward compatibility across environments at different migration states.

## Engineering Practice
- Debugged and fixed subtle production issues: timezone/date-string comparison bugs, non-volatile SQL function constraints, token-budget truncation limits.
- Wrote durable architectural documentation (CLAUDE.md) capturing non-obvious system decisions for future maintainers.
