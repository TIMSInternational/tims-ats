# Load tests (k6)

Read-only [k6](https://k6.io) load scenarios for TIMS ATS. k6 is a standalone binary, **not** an npm
dependency: install it with `brew install k6` (macOS) or from the k6 releases page, then check
`k6 version`.

| Script              | What it loads                                                                                                   | Auth                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `careers.js`        | (a) anonymous careers board + vacancy detail: the HTML pages and the tRPC reads the browser makes               | none                                     |
| `staff-reads.js`    | (b) a recruiter's candidate list and pipeline board: pages + `candidate.*`, `vacancy.list`, `pipeline.getBoard` | pre-issued Supabase session cookie       |
| `platform-reads.js` | (c) C# Platform API read endpoints, via the `/api/platform` relay (default) or directly                         | the same session's access token (bearer) |

## What is deliberately NOT covered

- **Public apply, CV upload URLs and Turnstile.** Nothing in this suite submits an application or
  asks for an upload URL. Load against those creates real records, real S3 objects and real
  captcha challenges.
- **Any write.** Every request is an HTTP GET. `tests/loadtest/loadtest-read-only.test.ts` fails CI
  if a script uses any other k6 HTTP verb or names a tRPC procedure that is not a `.query(`.
  (The app itself still does small bookkeeping on reads, e.g. a staff user's last-login timestamp
  at most once a minute; the suite issues no write requests.)
- **Login.** The suite never signs in. Automating login against the auth provider trips its rate
  limits and can lock the account. You issue a session by hand and pass it in.

## Safety rails built into the scripts

- **Host interlock.** Any target that is not `localhost`/`127.0.0.1` must be named exactly in
  `LOADTEST_ALLOW_HOSTS` (comma-separated hostnames) or the run refuses to start.
- **Small by default.** `PROFILE=smoke` (the default) is 1 VU for ~30 s. `VUS` above 50 refuses to
  start unless `LOADTEST_HIGH_LOAD=1`.
- **Preflight.** `setup()` makes one request per session/endpoint and aborts on anything but success
  (dead session, missing permission, a C# surface that is not enabled, no published vacancies),
  instead of timing a run full of 401/404s.
- **Session expiry check.** The run refuses to start if a session expires before the run ends
  (+2 min). An expired session makes the auth middleware rotate the refresh token, and many VUs
  doing that with the same refresh token is what refresh-token reuse detection revokes.
- **Early abort.** If more than `ABORT_ERROR_RATE` (default 10 %) of requests fail after the first
  30 s, the run aborts rather than keep hammering a struggling target.

## Configuration

| Variable                             | Default                                                                                       | Meaning                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `WEB_BASE_URL`                       | `http://localhost:3000`                                                                       | Next.js app origin                                                                                    |
| `PLATFORM_BASE_URL`                  | `$WEB_BASE_URL/api/platform`                                                                  | C# API base; set to the API's own origin to bypass the web tier                                       |
| `LOADTEST_ALLOW_HOSTS`               | (empty)                                                                                       | Hostnames you explicitly allow for this run                                                           |
| `PROFILE`                            | `smoke`                                                                                       | `smoke` or `ramp`                                                                                     |
| `VUS`                                | 1 (smoke) / 5 (ramp)                                                                          | Peak virtual users                                                                                    |
| `RAMP` / `HOLD` / `RAMP_DOWN`        | `5s/20s/5s` or `1m/3m/30s`                                                                    | Stage durations                                                                                       |
| `THINK_MIN_MS` / `THINK_MAX_MS`      | 1000 / 3000                                                                                   | Think time between user actions                                                                       |
| `P95_PAGE_MS` / `P95_API_MS`         | 1500 / 800                                                                                    | p95 latency thresholds for HTML pages and JSON APIs                                                   |
| `ERROR_RATE`                         | 0.01                                                                                          | Max non-429 failure rate                                                                              |
| `RATE_LIMITED_RATE`                  | 0.01                                                                                          | Max 429 rate (see "Rate limits")                                                                      |
| `CHECK_PASS_RATE`                    | 0.99                                                                                          | Min fraction of passing checks                                                                        |
| `ABORT_ERROR_RATE`                   | 0.1                                                                                           | Failure rate that aborts the run early                                                                |
| `CAREERS_ORG_SLUG`, `CAREERS_ORG_ID` | (required for `careers.js`)                                                                   | The synthetic tenant's careers slug and organization uuid                                             |
| `CAREERS_VACANCY_IDS`                | discovered                                                                                    | Comma-separated vacancy uuids                                                                         |
| `CAREERS_TRPC`                       | `1`                                                                                           | `0` loads only the server-rendered pages                                                              |
| `SESSION_COOKIE`                     | —                                                                                             | Full `Cookie` header value of a logged-in synthetic staff user (`staff-reads.js`)                     |
| `ACCESS_TOKEN`                       | from `SESSION_COOKIE`                                                                         | Bearer token for `platform-reads.js`; read from the session cookie when unset                         |
| `SESSIONS_FILE`                      | —                                                                                             | JSON array `[{"cookie": "...", "accessToken": "..."}]` (token optional), one entry per synthetic user |
| `STAFF_VACANCY_IDS`                  | discovered                                                                                    | Vacancy uuids for the pipeline board                                                                  |
| `PLATFORM_ENDPOINTS`                 | `/whoami,/reporting/kpis?period=30D,/reporting/funnel,/reporting/source-breakdown?period=30D` | C# GET paths                                                                                          |

k6 exits non-zero when any threshold fails (99), when a preflight aborts (108) or on a config
error (107), so the scripts can gate a pipeline.

## Run procedure (owner)

1. **Synthetic tenant only.** Use a tenant created for testing, with synthetic candidates and
   vacancies, never a customer tenant. The staff user must be a synthetic user of that tenant with
   read permission on candidates, vacancies and the pipeline. If the tenant enforces MFA, the
   session must be MFA-verified.
2. **Off-peak, announced.** Pick a low-traffic window, tell whoever is on call, and keep the hosting
   dashboards (web functions, API service, database) open while it runs.
3. **Prove the scripts locally first** (no environment needed):
   ```bash
   node scripts/loadtest/dev/mock-target.mjs
   ```
   In a second terminal, run any script with `WEB_BASE_URL=http://127.0.0.1:4310` and dummy
   `CAREERS_*` values (the mock accepts any session-shaped cookie and any bearer token; see the
   header of `dev/mock-target.mjs`). Stopping the mock prints the request count by method; any
   non-GET makes it exit 1.
4. **Issue a session by hand, right before the run.** Sign in as the synthetic user in a private
   browser window. From the developer tools, copy the request `Cookie` header of any app page into
   `SESSION_COOKIE` (one value: the scripts read the access token for the C# scenario out of the
   Supabase auth cookie inside it; `ACCESS_TOKEN` overrides that). For several users, put one
   `{"cookie": "..."}` entry per user in a `SESSIONS_FILE`. Keep these values in your shell or in a
   file **outside the repository**; never paste them into a ticket, a PR or chat, and never run k6
   with `--http-debug=full` (it prints headers, including the cookie). Sign the browser session out
   after the run.
5. **Start tiny.** `PROFILE=smoke` first, then `PROFILE=ramp` with `VUS=5`, then double while every
   threshold stays green. Stop at the first red threshold and read the hosting dashboards before
   going further.
   ```bash
   WEB_BASE_URL=https://<host> LOADTEST_ALLOW_HOSTS=<host> \
   CAREERS_ORG_SLUG=<synthetic-slug> CAREERS_ORG_ID=<synthetic-org-uuid> \
   PROFILE=smoke k6 run scripts/loadtest/careers.js
   ```
   ```bash
   WEB_BASE_URL=https://<host> LOADTEST_ALLOW_HOSTS=<host> SESSION_COOKIE="$SESSION_COOKIE" \
   PROFILE=ramp VUS=5 k6 run scripts/loadtest/staff-reads.js
   ```
   ```bash
   WEB_BASE_URL=https://<host> LOADTEST_ALLOW_HOSTS=<host> SESSION_COOKIE="$SESSION_COOKIE" \
   PROFILE=ramp VUS=5 k6 run scripts/loadtest/platform-reads.js
   ```
6. **Keep the evidence.** `k6 run --summary-export <file>.json ...` writes the end-of-test summary;
   store it outside the repository with the date, commit and profile used.

## Rate limits: what a single load generator can and cannot measure

The application rate-limits every tRPC procedure call and every C# API request
(`packages/api/src/middleware/rate-limit.ts`, `services/Tims.Platform/src/Tims.Domain/RateLimiting/RateLimits.cs`):
queries are limited per **user** when signed in and per **client IP** when anonymous (100 query
calls per minute at the time of writing; each procedure in a tRPC batch counts). Consequences:

- One synthetic user, or one anonymous load generator, tops out around that budget. Beyond it you
  are measuring the limiter, which the scripts report as `tims_rate_limited` (and fail on, by
  default) rather than as errors.
- To measure the system beyond one user's budget, spread VUs over **several synthetic users**
  (`SESSIONS_FILE`; VUs are assigned round-robin) and, for anonymous traffic, use several load
  generator IPs (or `CAREERS_TRPC=0` to load the pages alone).
- Do **not** work around the limiter by forging client-IP headers or by changing limiter code for a
  test. Both weaken a production control.

Rough sizing: with the default 1–3 s think time, one VU makes 4 tRPC procedure calls per iteration
of about 4 s in `careers.js` and `staff-reads.js`, and about one C# call every 2 s in
`platform-reads.js` — on the order of 30–60 calls a minute either way. Plan **one synthetic user per
VU** for the authenticated scenarios, and note that a user's tRPC and C# calls may share one budget.

## Reading the results

- `http_req_duration{kind:page}` / `{kind:api}`: the p95 thresholds. Per-request breakdowns are
  tagged by `name` (e.g. `staff_pipeline_board_trpc`).
- `tims_errors`: non-429 failures (5xx, 4xx, tRPC error envelopes, failed checks' requests).
- `tims_rate_limited`: 429s. Non-zero means you need more synthetic users or generators.
- `checks`: per-step assertions (status 200, HTML body, tRPC result count).

## Capacity review checklist (before raising the load)

Look these up in the hosting consoles and configuration, and write the concrete numbers down
somewhere private (not in this repository):

- **C# API service:** instance CPU/memory, min/max instances, and the per-instance concurrency that
  triggers scale-out. Peak concurrent requests ÷ per-instance concurrency must stay under max
  instances, and every instance holds its own database connection pools.
- **Web functions:** region (must be co-located with the database — see `vercel.json`), per-route
  `maxDuration` (`apps/web/app/api/trpc/[trpc]/route.ts`), and the plan's concurrency limits.
- **Database pooler:** the transaction pooler's client-connection and pool-size limits for the
  project's compute tier, and the database's own `max_connections`.
- **Application pools:** Prisma's pool is per serverless instance (set by `connection_limit` on the
  connection string, or Prisma's CPU-based default); the C# service registers several Npgsql data
  sources, each with its own pool (Npgsql's default maximum unless the connection string sets
  `Maximum Pool Size`). Multiply per-instance pools by the maximum instance count and compare with
  the pooler limits.
- **Rate limiter backing store:** confirm the shared (Redis) limiter is configured in the deployed
  environment; without it each instance keeps its own in-memory counters.
