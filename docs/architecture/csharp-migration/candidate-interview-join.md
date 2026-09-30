# C# candidate video-interview join (WP-H) — PR #308

Status: implemented, default disabled (`Platform:CandidateInterviewJoinEnabled=false`). No production
configuration changed by this slice. Interview scheduling itself (create/reschedule/cancel, the join-token
issue/clear, the invitation emails) still lives in TypeScript: there is no C# interview port, so the TS half of
this feature is in `packages/api` by necessity, not by choice.

## Contract

`POST /interviews/candidate-join` is anonymous. The body is exactly `{"token":"<43 chars base64url>"}`
(≤ 1024 bytes, one property). The emailed link `${appUrl}/interview/join/<token>` is the entire credential:
only its SHA-256 (lowercase hex) is stored, in `interviews.candidate_join_token_hash` (UNIQUE). The browser
never calls the platform API directly. `apps/web/app/api/interview-join/route.ts` relays same-origin requests,
never forwards cookies, and signs the client attribution (`x-tims-relay-attribution`) so the API can rate-limit
by the real client IP.

The response is `{ outcome, scheduledAt?, joinOpensAt?, joinUrl? }`, where `outcome` is one of `invalid`,
`cancelled`, `expired`, `too_early`, `not_video`, `ready` or `unavailable`. `joinUrl` (set only for `ready`) is the
interview's Daily room URL plus a NON-owner meeting token. The token has `nbf` = start − 15 min, and its `exp` is
the earlier of now + 2 h and end + 30 min. `eject_at_token_exp` is set.

The relay maps upstream answers to distinct page outcomes:

| Upstream          | Relay → browser                                     | Page shows                                     |
| ----------------- | --------------------------------------------------- | ---------------------------------------------- |
| 200 (valid shape) | 200, the outcome                                    | the outcome; `ready` redirects to `*.daily.co` |
| 404 (flag dark)   | 503 `{error:"join_not_enabled"}`                    | "not available yet — contact the recruiter"    |
| 429               | 429 `{error:"rate_limited"}`, Retry-After 1–900 s   | "too many attempts", Retry disabled for it     |
| anything else     | 502 `{error:"join_unavailable"}` (no upstream body) | "try again"                                    |

Retry on the page is disabled for 10 s after every answer, or for Retry-After (at most 120 s) after a 429.

## Security model

- **Rate limit.** The route is on the strict `auth` tier, keyed by IP. The path match is case-insensitive and
  tolerates a trailing slash, so `/interviews/candidate-join/` is not a way around it. The relay allow-list
  uses the same check (`CandidateInterviewJoinEndpoints.IsRoute`).
- **Tenant.** The hash lookup is the only pre-tenant statement. The `meeting_url` claim and the audit row run
  as `app_tenant` with `app.current_org_id` set to the resolved organization, and the claim's WHERE clause
  repeats `organization_id`. A test with RLS disabled proves that predicate by itself.
- **Room identity.** New rooms are named `tims-<full interview id, 32 hex>`. C# `RoomNameFor` and TS
  `roomNameFor` use the same scheme, so staff and candidate land in the same room. A stored `meeting_url` is
  joined only when all of these hold:
  - its room name is one this interview's id produces: the full-id name, or the legacy `tims-<first 8 hex>`
    name for rows created before this change;
  - the room Daily returns for that name is the same room on the same host. Daily's answer is authoritative
    for the account's `{domain}.daily.co`, so no separate domain setting is needed.

  Adopting an existing room on Daily's "already exists" 400 is safe only because every caller passes an
  own-id name. The TS staff path (`createVideoRoom` / `getVideoToken`) applies the same own-room rule before it
  mints any staff token.

- **External links.** A video interview whose `meetingUrl` is not our own Daily room (Zoom, Meet, Teams, a
  hand-pasted room) gets no join token. Candidate and evaluators receive the external link as-is, and the
  portal dashboard keeps its Join button. Our own private Daily URL is never emailed or linked, because it is
  dead without a meeting token. On the portal the candidate is pointed at the emailed link.
- **Audit.** Every resolved lookup writes an `audit_logs` row (`candidate_interview_join`, outcome only).
  If that row cannot be written, a `ready` answer is downgraded to `unavailable` (fail closed).
- **No leaks.** No log, audit row or response carries the token or its hash. Sentry `beforeSend` and
  `beforeSendTransaction` (browser, server, edge) scrub `/interview/join/<token>` from every event string. The
  staff `list`, `getById`, `saveTranscript` and `listToday` responses omit the token columns.

## Configuration

| Setting                                   | Default                   | Notes                                                                                                                                           |
| ----------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Platform__CandidateInterviewJoinEnabled` | `false`                   | Route not mapped when false (the relay then answers `join_not_enabled`).                                                                        |
| `Daily__ApiKey`                           | empty                     | Secret. Blank or `REPLACE_ME_OUT_OF_BAND` counts as not configured: joins answer `unavailable`, and startup logs a WARNING when the flag is on. |
| `Daily__ApiUrl`                           | `https://api.daily.co/v1` | Validated at startup.                                                                                                                           |

The web side needs `NEXT_PUBLIC_TIMS_PLATFORM_API_URL` (already used by other relays) and `NEXTAUTH_SECRET`
(relay signing, byte-identical to `Platform__ImpersonationSecret`). `DAILY_API_KEY` / `DAILY_API_URL` stay the
TS staff-room settings. `.env.example` is not edited by this slice. It should gain commented entries for
`DAILY_API_KEY`, `DAILY_API_URL`, and a note that the C# service reads `Daily__ApiKey`, `Daily__ApiUrl` and
`Platform__CandidateInterviewJoinEnabled`.

## Interview email delivery (TS)

Invitations, updates and cancellations are sent through SES `SendRawEmail` as MIME with an `.ics`
(REQUEST/CANCEL, a stable UID, and a SEQUENCE taken from `updated_at`).

- **Separate breaker.** Raw sends run in their OWN breaker (`sesRawCircuit`), never the shared `sesCircuit`.
- **Permission denial.** An `AccessDenied`/`NotAuthorized` answer is not a breaker failure. It is cached per
  instance for 10 minutes and answered without calling SES. The mail falls back to plain HTML (no `.ics`).
- **Paused raw sends.** If the raw breaker is open, mail also falls back to plain HTML.
- **Single failure.** A single failed raw send is not re-sent as plain, because SES may already have
  accepted it.

**`ses:SendRawEmail` is REQUIRED for the `.ics`.** Without it every interview email still arrives, but
without a calendar attachment.

## Activation order

1. Grant the web runtime's SES identity `ses:SendRawEmail` (same identity/region as `ses:SendEmail`).
2. Put the Daily key in Secrets Manager and wire `Daily__ApiKey` into the App Runner service's
   `RuntimeEnvironmentSecrets`. ⚠️ `update-service` REPLACES the whole map: submit the full existing
   `RuntimeEnvironmentSecrets` + `RuntimeEnvironmentVariables` plus the new entry, never the new entry alone.
3. Deploy the C# image, then set `Platform__CandidateInterviewJoinEnabled=true`. Confirm that there is no
   startup WARNING and that `POST /interviews/candidate-join` with a malformed body answers 400, not 404.
4. Apply the Prisma migration `20260929120000_interview_candidate_join_token`, then deploy the web app. Only
   after step 3: before it, every emailed join link lands on "not available yet — contact the recruiter".
5. Schedule a test video interview to a controlled mailbox. Check the `.ics`, the join window (15 min early,
   30 min grace), the staff room and the candidate landing in the same room, and the audit row.

## Evidence

- **C# unit tests** (`CandidateInterviewJoinTests`) cover:
  - token format and hash-only lookup;
  - the window and status matrix;
  - own-room vs foreign-room vs other-domain rooms;
  - the concurrent-claim winner;
  - fail-closed audit.
- **C# integration tests** cover:
  - `DailyVideoProviderTests`: room create/adopt/extend, and the guest token is never an owner;
  - blank and placeholder key handling, plus the startup warning;
  - the repository against a real Postgres, with forced RLS and with RLS disabled;
  - the endpoint;
  - rate-limit and relay-attribution path spellings.
- **TS tests**:
  - the join-token helpers and room naming (same fixture as C#);
  - email wiring, including external links and never emailing the own Daily URL;
  - raw-SES isolation against the REAL breaker (`tests/interview/ses-raw-fallback.test.ts`);
  - media room binding;
  - the relay (404/429/5xx);
  - the join page (redirect, unsafe URL, throttle);
  - the portal dashboard;
  - Sentry redaction.

## Known residuals

- Rows that already store a legacy `tims-<8 hex>` room keep it. If two interviews shared an 8-hex prefix
  before this change, they may already share a room. That cannot be fixed retroactively from the name alone.
- Distributed rate limiting depends on Redis. Without it, the per-IP budget is per instance.
