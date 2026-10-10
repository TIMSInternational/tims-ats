# TIMS ATS application readiness audit — 2026-10-10

This is a product-wide **release-readiness inventory**, not a claim that every route or role has been exercised. It
compares the product contract in `docs/PRODUCT-MAP.md` and the .NET migration plan with current `main`, open
GitHub work, CI, and a read-only walkthrough of the production UI. The June percentages in the product map and
older "awaiting deploy" entries in `docs/REMAINING-WORK.md` are historical. Do not use them as current completion
percentages.

## Evidence and limits

- `main` at `e9276195` deployed successfully to Vercel on October 1; main CI and E2E were green at that commit.
  This proves build/deployment, not that all application paths are activated or accepted.
- The production session showed platform Offers, Health and Feature Flags; the TIMS International vacancy, careers
  board, vacancy detail and the first step of the application form were inspected without changing production
  records. The synthetic vacancy is published and appears on the public board. No new application, invitation,
  offer or candidate decision was submitted in this audit.
- The Health page reported **1 of 8** services actually monitored: database connectivity was operational, while
  API, auth, storage, workers, AI, SES and realtime showed no telemetry. It displayed 15 organizations, 32 users
  and two vacancies. This is a truthful UI, but it is not an operational readiness proof for those seven services.
- The published synthetic vacancy had no company, department or hiring manager in its staff detail. The public
  board used a generic company label; the detail page resolved the organization name. Its application modal
  exposed the expected three-step progression, but the final submit and Turnstile were not exercised here.
- The four open PRs were #278 (draft/conflicting proctoring), #335 (mergeable backfills), #336 (mergeable CI/security
  controls, with pre-merge environment setup), and #341 (conflicting parity registration). The open issue list has
  115 entries, including historical migration epics; issue count is not a completion metric.

## First-company beta gates, in execution order

| Gate                       | Current evidence                                                                                                                                                                                                                                                                             | Pass condition                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production controls        | Nightly DB controls failed October 2–10: `PROD_DIRECT_URL` uses `sslmode=require` where the guard requires `verify-full`. The October 4 backup/restore drill failed because `PROD_BACKUP_DRILL_URL` is absent.                                                                               | Protect the `prod-db-controls` GitHub environment as #336 requires; repair the TLS credential; provision the scoped drill credential; obtain a green scheduled DB run and a real restore-drill result.                                                                                                                                                                                                                                             |
| Shared abuse protection    | #340 reports no production `UPSTASH_REDIS_REST_URL`/token, leaving the TS limiter per Vercel instance.                                                                                                                                                                                       | Configure shared Redis in production, redeploy, and show the same bounded counter across separate instances for login/reset, API and email limits.                                                                                                                                                                                                                                                                                                 |
| Consent and tenant privacy | #346 found a candidate join link still minting video tokens after recruitment-consent withdrawal; #344 identifies user-reference writes that do not verify tenant membership.                                                                                                                | Ship and live-verify the join revocation fix, including withdrawal during room provisioning; reject cross-tenant feedback/recognition/coaching references with tests. Already-issued Daily tokens remain valid for their provider TTL and need a separate explicit policy if immediate room ejection is required.                                                                                                                                  |
| Customer setup             | #335 provides guarded onboarding and structure backfills but has not been applied. Its October 1 dry run found zero existing onboarding plans and 11 empty organization shells lacking structure. The published TIMS test vacancy still lacks company/department/hiring-manager assignments. | Decide which empty shells to retain, merge #335, dry-run on current production, apply only the approved totals, and assign company/unit/team leaders and vacancies in a real test organization. A leader must see and approve only their scoped vacancies.                                                                                                                                                                                         |
| Real company journey       | CI Playwright passes, but #330's offer-approval scenario passes only on retry. Production walkthrough reached application entry, not final submission.                                                                                                                                       | Repeat with named test roles on the deployed revision: invite → create password/sign in → draft/approve/publish vacancy → real Turnstile apply → candidate portal/recruiter pipeline → interview and scorecard → approved offer and candidate acceptance → employee/onboarding tasks. Assert email receipt, audit events, tenant isolation and rollback at every transition. Diagnose #330's first-attempt failure instead of accepting the retry. |
| Background reliability     | The public application route currently waits up to 20 seconds for S3 retrieval, extraction and AI parsing. Errors or timeouts leave the CV unparsed without an automatic retry; #333 tracks the recovery gap. Health shows no worker telemetry.                                              | Put parse work behind a durable queue/reconciler with bounded retries and alerting; test process termination and replay without duplicate candidate records.                                                                                                                                                                                                                                                                                       |
| Assessment credibility     | #42 says the norm-scoring backfill has not run; approved batteries/scoring/norms and a real candidate result still need acceptance. #278 is a dark, conflicting draft for AWS camera/screen evidence and inference.                                                                          | Run an approved battery end to end and verify scoring provenance. Separately complete proctoring staging, consent/retention review, false-alert evaluation, human review and the 25-candidate/30-minute load-cost trial before enabling its flags.                                                                                                                                                                                                 |
| Operations visibility      | Production Health checks only database connectivity; #347 requires the security-denial audit index, retention design and an alert consumer.                                                                                                                                                  | Add telemetry for API, auth, storage, workers, AI, SES and realtime; verify alerts for lost audit rows, queue failures, SES rejection, cost limits and backup failure.                                                                                                                                                                                                                                                                             |

## Full-product work beyond the first beta

The intended product covers recruitment, assessments, onboarding, performance, succession, compensation, learning,
engagement, billing, platform administration, AI and external integrations. The current architecture intentionally
keeps the Next.js frontend. The .NET 10 backend migration is incomplete: Phase 5 still has routed domains and
TypeScript procedures to retire (#252); Phase 6 needs the `tims.configuration.core` intake and authorized API
mapping (#104); Phase 7 removes tRPC/Prisma only after per-domain parity, production verification and ownership
flips. PR #341 advances parity coverage but has not run its new surfaces against production. Billing's live Stripe
cutover (#53) is a separate owner gate, not a first-company beta prerequisite unless live self-service billing is
promised.

Other concrete follow-ups: canonicalize candidate email identity with a collision report (#315); validate bearer
links use HTTPS in production (#343); add a suite-wide AWS test boundary (#316, PR #354; the SES abort test itself is already non-vacuous); repair the root
`pnpm --filter @tims/db generate` script, which currently cannot locate the multi-file Prisma schema (explicit
`--schema=prisma/schema` succeeds); fix Next's build-time ESLint configuration, which currently prints
`Could not find plugin "@typescript-eslint"` but still exits 0; and fix the public vacancy detail's Spanish
relative-date grammar and the raw `published` status shown in the staff SLA panel.

The October 10 PR gate also discovered two new HIGH production dependency advisories:
`source-map-js` 1.2.1 and `sharp` 0.35.4. PR #349 pins their verified patched releases 1.2.2 and 0.35.5.
After that change, `pnpm audit --prod --audit-level high` exited 0; 11 lower-severity findings remain for
normal dependency triage.

## Exit decision

Do not call the platform fully production-ready from a successful deployment or CI alone. First-company beta can
start after the live controls, shared rate limiting, tenant/privacy fixes, named-role company journey and worker
recovery gates above are green. Full-product completion additionally requires assessment/proctoring acceptance,
external integration and the remaining .NET migration. A completion percentage requires a weighted acceptance
register with each requirement marked deployed, production-tested, excluded from beta or blocked.
