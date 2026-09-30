# E2E — Playwright journeys

Two end-to-end journeys, driven through the real UI against a throwaway, **local-only** stack:

| Project     | Spec                                        | Story                                                                                                                                                |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `company`   | `specs/company/company-journey.spec.ts`     | platform owner creates a company → invites its admin → admin accepts → team invited and accepts → recruiter creates a vacancy → approval → published |
| `candidate` | `specs/candidate/candidate-journey.spec.ts` | careers page → apply → pipeline → stage moves → interview → scorecard → offer → approval → signing link → signature → hire → onboarding plan         |

`candidate` depends on `company` (it applies to the vacancy `company` published). Each file is a
`serial` story; every run uses a fresh run id, so every email, slug and title is unique and reruns
never collide.

## Running locally

```bash
pnpm install --frozen-lockfile
pnpm --filter @tims/e2e exec playwright install chromium
bash scripts/e2e/up.sh                       # ~10–15 min cold (API image + next build)
pnpm --filter @tims/e2e exec playwright test # or: cd e2e && pnpm exec playwright test --ui
bash scripts/e2e/down.sh                     # --purge also deletes e2e/.state
```

Iterating on specs only: the stack keeps running between `playwright test` runs. After changing app
code, re-run `up.sh`; `E2E_SKIP_API_BUILD=1` / `E2E_SKIP_WEB_BUILD=1` reuse the previous builds —
only valid while `e2e/.state` is unchanged (the web build inlines the per-bring-up anon key).

Ports (fixed, chosen not to clash with the Supabase CLI defaults or the manual `e2e` stack):
app `https://localhost:3543`, API `https://localhost:7543`, Supabase `55321`/`55322`,
LocalStack `4577`.

## What the stack is (scripts/e2e/up.sh)

Supabase CLI (auth + Postgres) → the committed **production schema baseline** + `seed.ts` +
`seed-access.ts --apply` → the C# API container (production Dockerfile) → LocalStack (SES, S3) →
Redis → Caddy (TLS for the API and for Supabase-as-seen-by-the-API) → `next build` served over TLS
by `scripts/e2e/web-server.mjs`. CI (`.github/workflows/e2e.yml`) calls the same script.

Safety properties:

- **Never touches production.** Every URL the stack hands to a process, and every URL in the
  generated env files, is asserted to be `localhost` / `127.0.0.1` / a stack container
  (`e2e_assert_local_url`, `e2e_assert_env_file_local`); the specs re-assert it in `lib/stack.ts`.
- **No secrets.** The JWT signing key, service keys, relay secret and every password are generated
  per bring-up into the gitignored `e2e/.state/` and are never printed or uploaded.
- **No external AI / video.** No Bedrock, Daily or ElevenLabs credentials exist in the stack; the AWS
  SDK endpoint is LocalStack; the browser aborts any request to Daily/ElevenLabs/LiveKit
  (`lib/persona.ts`); specs never press an AI button and schedule interviews **in person**.
- **No real email.** Both the web app and the API send through LocalStack SES; `lib/mail.ts` reads
  the messages back from `GET /_aws/ses` (including raw MIME with an `.ics`).

Deviations from the production shape, each deliberate:

- `flip-ddl/*.sql` are **not applied**: the production baseline already contains those tables, and
  each file refuses to run on a database with a `supabase_migrations` schema (which the baseline
  creates). `up.sh` instead asserts every table they define exists.
- The web app is served by `web-server.mjs` rather than `next start` behind a proxy, because
  `/api/platform` rejects requests whose `Origin` differs from the origin Next derives from its own
  listen address; and Supabase is proxied same-origin so the production CSP (`connect-src` allows
  only `*.supabase.co`) stays fully enforced without patching the app.
- The public apply form uses Cloudflare Turnstile's documented always-pass **test keys**; the widget
  and the server-side verification still call `challenges.cloudflare.com`.

## Steps waiting on unmerged PRs (`test.fixme`)

Specs for steps whose fix is not on `main` are written against the intended UI (read from the PR
branch) and marked fixme through `needs()` in `lib/pending.ts`, so the suite is green on `main`.
**When a PR merges, set `merged: true` for its entry in `lib/pending.ts`** — its specs switch on and
any main-only workaround step guarded by `supersededBy()` switches off in the same one-line change.
The stack already sets those PRs' feature flags (`scripts/e2e/*-flags.env`).

| `lib/pending.ts` key | PR                     | Spec(s) switched on                                                                                                 | Main-only workaround switched off            |
| -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `offerSigningPublic` | #300                   | candidate signs on the public page; admin authorizes the hire → onboarding plan exists; (with #309) default tasks   | —                                            |
| `cvUploadCsp`        | #300 **+ see note**    | candidate applies with a CV upload (with #302)                                                                      | candidate applies without a CV               |
| `explicitConsent`    | #302                   | candidate applies with a CV upload (with #300); consent is asserted on every apply                                  | candidate applies without a CV               |
| `scorecards`         | #303                   | hiring leader submits a scorecard from the interview room                                                           | —                                            |
| `peopleDirectory`    | #304                   | recruiter schedules the interview; (with #310) recruiter submits the vacancy / requests offer approval              | admin schedules the interview                |
| `tenantInvitations`  | #307                   | company admin invites the team from the Equipo page                                                                 | platform owner invites the team              |
| `candidateEmails`    | #308                   | candidate receives the "application received" email                                                                 | —                                            |
| `onboardingDefaults` | #309                   | the onboarding plan starts with the default task checklist                                                          | —                                            |
| `orgStructure`       | #310 (stacked on #304) | admin sets up a unit/team led by the leader; recruiter → leader vacancy approval; recruiter → leader offer approval | admin submits + approves the vacancy / offer |

**Note on `cvUploadCsp`:** #300 allows only the exact `https://<bucket>.s3.<region>.amazonaws.com`
origin in `connect-src`, so against LocalStack the CV upload stays blocked even after #300 merges.
Switching this entry on also needs a CSP allowance for a configured non-AWS S3 endpoint (dev/test
only), which no PR provides yet.

How much of each fixme spec has been exercised: the signing → hire → onboarding-plan specs were run
green on `main` with only the signing route made reachable by hand (proving the rest of that chain
works today); the others are written against their PR branch's source but have not been run against
a build of that branch.
