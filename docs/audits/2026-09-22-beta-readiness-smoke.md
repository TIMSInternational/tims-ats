# Beta readiness smoke — 2026-09-22

## Verdict

TIMS ATS is **not yet ready for an unrestricted beta**. The local invitation and
recruitment happy paths are partially verified, but public application, live
email delivery, production account recovery/sign-in, assessments, and several
cross-module journeys still lack acceptance evidence. This is a tested slice,
not a claim that every requirement in the acceptance register has passed.

## Environment and automated checks

- Local Next.js on `http://localhost:3100`, C#/.NET 10 API on
  `https://localhost:7180`, local PostgreSQL `tims`. The signed-in test user
  belonged to the seeded AgroVerde organization. Synthetic vacancy, candidate,
  and interview records were used; no production records were changed.
- Invitation-onboarding branch: 3,389 Vitest tests, 1,377 .NET unit tests,
  1,850 .NET integration tests, and both API/web TypeScript checks passed.
  Invitation PR [#265](https://github.com/TIMSInternational/tims-ats/pull/265)
  remains open and review-required; production onboarding is not verified.
- This vacancy-stage fix branch: 3,349 Vitest tests, both API/web TypeScript
  checks, a Next.js production build with synthetic local build-time env, and
  focused vacancy-creation tests passed. The focused checks assert starter
  stages for draft, approved, and auto-published creation paths.
- `pnpm audit --prod --audit-level high` reported zero high and zero critical
  vulnerabilities (three moderate, two low). Production `/login` and
  `/careers/agroverde` returned HTTP 200; these are availability checks only.

## Local journey results

| Journey                                 | Result                    | Evidence / limit                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation acceptance and tenant role   | Pass locally              | Existing-account completion produced tenant user, `super_admin` role, accepted invitation, one audit row, and signed-in dashboard. Later sign-out/sign-in was not exercised.                                                                                                                                                                                                                                                                                                  |
| Vacancy creation, approval, publication | Pass locally              | Synthetic vacancy moved draft → pending → approved → published; public AgroVerde board and job detail showed it.                                                                                                                                                                                                                                                                                                                                                              |
| Candidate creation                      | Pass locally              | Synthetic candidate appeared in recruiter list and profile.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Add candidate to a new vacancy          | **Failed before fix**     | The vacancy had zero pipeline stages and the API returned `La vacante no tiene etapas de pipeline configuradas`.                                                                                                                                                                                                                                                                                                                                                              |
| Existing-vacancy repair                 | Pass locally              | Manual backfill inserted seven stages for the one stage-less local vacancy; a second run inserted zero. Under `app_tenant`, unset organization GUC saw zero stages and AgroVerde saw its fourteen test stages.                                                                                                                                                                                                                                                                |
| New-vacancy stage initialization        | Pass locally with patch   | A second vacancy created through the UI had seven stages and exactly one default `Aplicado` stage in PostgreSQL.                                                                                                                                                                                                                                                                                                                                                              |
| Candidate assignment and movement       | Pass locally after repair | Existing candidate joined the vacancy's `Aplicado` stage and advanced to `Screening`; profile timeline recorded the move.                                                                                                                                                                                                                                                                                                                                                     |
| Interview scheduling                    | Pass locally              | A telephone interview for the synthetic candidate and test vacancy was saved and appeared in the interview list/calendar. External delivery was not verified.                                                                                                                                                                                                                                                                                                                 |
| Public job application                  | **Blocked locally**       | Form reached final review, but the submit button stayed disabled because Turnstile returned `110200` on `localhost`. [Cloudflare identifies this code as an unauthorized domain](https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/). Use [official test site and secret keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/) together in local development, then test the real production widget separately. |
| Assessment authoring/player             | Unverified                | The fresh local organization showed no assessment types; approved batteries, scoring rules, and norms are required before scientific result acceptance.                                                                                                                                                                                                                                                                                                                       |
| Learning dashboard data integrity       | **Failed**                | With zero courses and learners, the page still displayed fabricated growth, gap reduction, learning paths, test gains, team progress, and AI recommendations from hardcoded demo values. These cannot be presented as tenant results in beta.                                                                                                                                                                                                                                 |

## Fix in this branch

`vacancy.create` now nests seven starter pipeline stages inside the Prisma
vacancy creation. The nested write is atomic for draft, approved, and
auto-published vacancies. The manual
`packages/db/prisma/manual/2026-09-22-backfill-vacancy-stages.sql` repairs
non-deleted historical vacancies that have no stages, leaves customized
pipelines alone, and is idempotent. It was executed only against the local
test database. Review target counts before applying it to production.

## Follow-up fixes opened during this audit

- [#267](https://github.com/TIMSInternational/tims-ats/pull/267) removes fabricated Learning metrics and panels and shows API-backed empty states. Its own checks passed, but it remains review-required and undeployed.
- [#268](https://github.com/TIMSInternational/tims-ats/pull/268) removes fabricated Onboarding courses, access requests and routes, shows persisted check-ins, and corrects active-plan KPI counts. Its own checks passed, but it remains review-required and undeployed.
- [#269](https://github.com/TIMSInternational/tims-ats/issues/269) tracks inert candidate-profile header actions found while attempting the offer journey.

## Required beta exit checks

1. Merge and deploy invitation PR #265 and this recruitment fix after review;
   verify the feature flags and production API health.
2. Review and apply the historical vacancy-stage backfill to the target
   database, then verify tenant-specific counts and one newly created vacancy.
3. Run a fresh real-recipient invitation canary: provider acceptance,
   inbox delivery, account setup, sign-out/sign-in, organization role, audit,
   expiry/revocation, and duplicate acceptance. The earlier provider failure
   is still unresolved.
4. Run a fresh public candidate application with a real production Turnstile
   token; verify candidate/application records, tenant isolation, recruiter
   visibility, pipeline movement, and candidate portal access.
5. Complete at least one offer → acceptance → onboarding journey and an
   assessment assignment → completion → validated score journey before those
   capabilities are included in beta scope.
6. Exercise role and cross-tenant denial, exports, notification delivery,
   background jobs, monitoring, backup/restore, and a modest concurrent-user
   load test in the beta environment. The external TIMS configuration API
   exchange remains unverified.
7. Merge and deploy #267 and #268 after review, then confirm that empty beta
   organizations show no fabricated Learning or Onboarding results.

See `docs/plans/2026-09-14-acceptance-register.md` for the wider requirements
inventory. Its rows are not acceptance evidence until linked to actual runs.
