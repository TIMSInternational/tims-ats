# Deployment

- **Phase 1 (launch):** Vercel (auto-scaling, zero-ops) + Supabase Team ($599/mo, ~200 pooled connections).
- **Phase 2 (scale):** AWS ECS Fargate for AI gateway + API if Vercel limits hit.
- **Region:** Supabase DB runs in **`us-west-2`** (prod pooler `aws-1-us-west-2.pooler.supabase.com`). Vercel functions are pinned to **`pdx1`** (us-west-2) via `vercel.json` `regions` + the tRPC route's `preferredRegion`, co-locating compute with the DB to kill cross-region query latency. _(Aspirational, not yet done: migrating the DB to `sa-east-1`/São Paulo would cut latency for Bogotá end-users ~40ms vs ~120ms — an owner infra decision, would then re-pin Vercel to `gru1`.)_
- **CDN:** Vercel Edge for static assets. API routes: no-cache.

## CI/CD Security Gates

```
Pre-commit:   Gitleaks (block secrets) · ESLint @typescript-eslint/no-explicit-any
Pull Request: tsc --noEmit (zero errors) · Semgrep (block high/critical) · npm audit
Pre-deploy:   Supabase RLS audit (all tables have policies) · env var validation
Post-deploy:  Sentry error monitoring (no stack traces in responses) · runtime secret scanning
```

- **Codex cross-model verification** runs at every build's review gate (alongside the per-slice + opus reviews) — see `.claude/rules/verification.md`.
