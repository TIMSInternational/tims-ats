# Cross-system e2e: TIMS ATS ↔ TIMS Assessments (tims-suite /v1)

**Needs both stacks running locally.** It is never part of CI: `e2e/playwright.config.ts` does not reach this
directory, and `cross.spec.ts` skips itself unless `ASSESSMENTS_CROSS_STATE` names the state file `stack/up.sh`
writes. Nothing here talks to production, a remote database or AWS, and every secret is generated per bring-up.

## Run it

```bash
# 1. both repos installed (pnpm install), Docker running, dotnet 10, psql
SUITE_DIR=/path/to/tims-suite bash apps/web/e2e/assessments-cross/stack/up.sh   # ~15 min cold
# 2. the spec (Playwright lives in e2e/; NODE_PATH lets the spec resolve it from here)
cd e2e
NODE_PATH=$PWD/node_modules \
ASSESSMENTS_CROSS_STATE=../apps/web/e2e/assessments-cross/.state/cross.json \
ASSESSMENTS_CROSS_REPORT=../apps/web/e2e/assessments-cross/.state/report.json \
  pnpm exec playwright test -c ../apps/web/e2e/assessments-cross/playwright.config.ts
# 3. tear down
bash ../apps/web/e2e/assessments-cross/stack/down.sh          # --purge also deletes .state/
```

`SUITE_DIR` must be a tims-suite checkout at `release/assessments-v1` or later. `CROSS_PREFIX` names the
containers (default `assessments-cross-*`), `CROSS_STATE_DIR` moves the state directory, and
`CROSS_SKIP_API_BUILD=1` / `CROSS_SKIP_WEB_BUILD=1` reuse the previous builds.

`CROSS_EMBED=1` builds the portal **embedded**, as timssuite.com does it: it frames the hosted player
(`NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN`; the local ATS origin is the partner's registered frame ancestor) and the PCA
provider's page in a sandboxed frame (`NEXT_PUBLIC_ASSESSMENT_PROVIDER_FRAME_ORIGIN`, the local stand-in). The spec
reads the mode from `cross.json` (`embedded`). The player draws timssuite.com's own screens; `player-driver.ts` drives
them as the suite's hosted e2e driver does (`data-tims-part` option | ack | submit | skip, `data-tims-key`, the lockdown
overlay, DOM clicks while the frame is fullscreen) and names each distinct screen for the walkthrough.

`ASSESSMENTS_CROSS_RECORD=<dir>` records a walkthrough: video and a trace of every test, an HTML report in
`<dir>/html`, and numbered screenshots in story order in `<dir>/shots`.

## What `stack/up.sh` builds

| Side  | Piece                                                                                                                                                                                                                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| suite | `stack/suite-up.ts`: PostgreSQL 16 with the suite schema (baseline + every migration), PostgREST, the real API (`V1_PARTNER_API_ENABLED`, webhooks, `CRON_SECRET`, `V1_ALLOW_DRAFT_CONSENT_TEXTS=true`), the hosted player over https with `/api` proxied same-origin                             |
| suite | the ATS provisioned with the suite's own `scripts/v1-create-partner-client.ts --profile ats` (registered origin = the local ATS origin) and its webhook subscription created through the public API (`scripts/v1-create-webhook-subscription.ts`)                                                 |
| ATS   | PostgreSQL (Supabase image): the production baseline, every Prisma migration after `applied-through.txt`, then the C# provider/FIT manual DDL in the owner order; GoTrue (ES256) and Mailpit (the candidate's sign-in code); seeds incl. `seed-users.ts` and `seed-demo.ts`                       |
| ATS   | the C# Platform API in a container (the throwaway CA in its trust store) with `AssessmentProvidersEnabled`, `CandidateConsentEnabled` and FIT v2 read/write on; apps/web `next build` with `NEXT_PUBLIC_ASSESSMENT_PROVIDERS_VIA_CSHARP`, `..._FIT_ENGINE_V2_...` and `..._CANDIDATE_CONSENT_...` |

Two local-only allowances, both outside the products' code:

- **Webhooks to loopback.** The suite refuses webhook targets on private or loopback addresses (its SSRF guard).
  `stack/suite-loopback-shim.cjs` is preloaded into the suite API this harness starts and allows exactly
  `127.0.0.1` and `::1`; signing, delivery and every other check are the real code.
- **IPv4 to the player.** `vite preview` listens on `[::1]` only; `stack/v4forward.mjs` forwards `127.0.0.1` to it
  (TLS untouched) so the C# container reaches the suite through Docker's host gateway.

## What the spec drives (one serial story)

H1 bind the org (token, catalog, tenant) · H2 HR sets LIA (scored), English (gate), Personality and PCA (advisory) on
a vacancy · H3 three candidates apply on the careers page · H4 HR assigns (age band, notice) A and B, and the ATS
creates the subject and one `/v1` assignment per test · H4b HR turns on lockdown and alert control (warn at 3) in
Settings > Assessment security and assigns C; only C's sittings carry that proctoring · H5 candidate A signs in with
the mailed code, consents and completes the three sittings in the hosted player (framed: on the player's `sitting_ended` the
frame stays on the suite's receipt and "Back to my assessments" returns to a dashboard that already shows Completed) and PCA on the provider's page (framed with timssuite.com's PCA header; leaving asks
first) · H5b C's LIA shows the suite's lockdown overlay, enters full screen, and one tab switch draws the suite's
anti-cheat warning (embedded only; headless Chromium never hides a page, so the frame reports the switch through
`visibilitychange`) · H6 signed events reach the ATS inbox and every result is fetched (PCA: the scheduled
run polls the provider) · H7 the provider results create the candidate's FIT v2 row, with no HR compute · H8 HR sees
each result, and the Assessments tab's results board draws every profile (LIA subtests, English skills, Personality
dimensions, PCA's DISC graphs and competencies) · H9 a
team leader sees only "below minimum" (D6) · H10 candidate B accepts the optional voice consents and the English
sitting serves its speaking item · H11 HR cancels B's English · H12 B's Personality expires (time travel in the
suite database, then the scheduled run) · H13 B withdraws consent in the portal and the ATS cascades to the provider ·
H14 DSAR export, then erasure (time travel past the upload-fence drain) and `subject.erased`.

Local fixtures the spec sets itself: the vacancy is moved to the team the seeded leader leads, and the seeded
`leader` role gets `assessment:read` at team scope by applying the owner step
`services/Tims.Platform/db/owner/leader_assessment_read.sql` verbatim (the seed grants it none, so without that step it
would see no card at all).

**Local differences:** the English listening clips come from the suite's public fallback (no S3), so the suite publishes
English as `needs_review` (`human_review_required`); H8 then checks the review state and H9 runs the D6 check on the LIA.

**Not covered locally:** anything that needs AWS — the English speaking upload (S3) and its AI scoring (Bedrock), and
the ITC-IA judge — and the real TIMS PCA site (a stand-in answers its API; every real survey is billable). ITC-IA and MI
are not assignable from the ATS (the catalog marks them not for selection).
