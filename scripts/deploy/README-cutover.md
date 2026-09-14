# `cutover.sh` — per-domain flip-and-verify automation

One generic script for the C# strangler-fig production cutover of the **standard** domains (the
ones using the normal staff-JWT/browser-cookie auth pattern). It wraps the recipe in
[`docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`](../../docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md)
§6 so cutting a surface over is a couple of copy-pasteable commands instead of ten bespoke
runbooks.

**Out of scope, on purpose:** `external-vendor`, `billing-webhook`, and `billing-self-serve` use a
different auth mechanism (API keys / Stripe webhooks, not staff-JWT) and are handled by a separate
workstream — they are deliberately absent from this script's surface table.

**Who runs what.** Same rule as the runbook: `--verify-only` is safe for anyone to run — with two
caveats that `cutover.sh`'s own safety block spells out and that were undocumented until 2026-08-11.
`verify-write <key>` is **mutating by design** (it writes and reads back). And `verify access-review`
attempts four `audit_logs` inserts that the org-id FK rejects, while `verify audit-log` pulls up to
~2000 cross-tenant audit rows — including actor emails and IP addresses — onto the machine running
it. Neither prints anything sensitive, but neither is literally "read-only" either. `--flip-backend`/`--rollback` with `--yes` touches real
AWS infrastructure — that is **Federico-run only** (`I never touch prod`, applies to whoever is at
the keyboard, human or agent). Without `--yes` both modes only print the commands; nothing is
executed.

## The three modes

| Mode             | Mutates anything? | What it does                                                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `--verify-only`  | Read-only\*       | Runs `scripts/parity/cli.ts verify[-write] <key>` for real and reports pass/fail. \*See the caveats above.   |
| `--flip-backend` | Only with `--yes` | Prints (or runs) the `aws apprunner update-service` recipe that flips `Platform:<Surface>Enabled` to `true`. |
| `--rollback`     | Only with `--yes` | Same recipe, flips the flag back to `false`, plus prints the FE Vercel-revert steps.                         |

Run `./scripts/deploy/cutover.sh --list` for the full surface table (flag name, parity CLI key, FE
flag, and CONFIRMED LIVE / FLIP-READY / COEXISTENCE / BLOCKED / TS DELETED status per
[the runbook's §6 classification](../../docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md#6-per-surface-cutover-one-flag-at-a-time-ts-stays-until-prod-verified)).

## Worked example: cutting over `engagement`

```bash
# 1) Verify — read-only (see the caveats above), needs scripts/parity/.env populated
#    (see scripts/parity/README.md) and a live, reachable C# service.
./scripts/deploy/cutover.sh engagement --verify-only

# 2) Once that's green, flip the backend flag AND re-verify in the same breath — the script
#    refuses to flip unless a verify pass is bundled into the same invocation (see "sequencing
#    safety" below). --yes is what actually executes the AWS CLI call; without it you get a
#    dry-run printout of the exact command.
./scripts/deploy/cutover.sh engagement --verify-only --flip-backend --yes

# 3) Canary/monitor per the runbook, then flip the FE flag too
#    (NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP=true in Vercel Production + redeploy) — this script
#    does not touch Vercel; that step stays manual per the runbook (§6: "The flag alone does not
#    move the FE.").

# If anything looks wrong at any point, roll back immediately — no re-verify needed:
./scripts/deploy/cutover.sh engagement --rollback --yes
```

**Why `engagement` was the last worked example, and what to use now.** As of 2026-07-31, every
standard surface this script covers has either had its TS side fully deleted (`team-intel`,
`reporting`, `billing-read`, `billing-usage`, `evaluation360` read, `audit-log`, `access-review`
read+write — all TS DELETED, joined by `nine-box` read on 2026-08-05 per #57) or is CONFIRMED LIVE
with partial TS deletion (`succession`, `compensation`, `dei`, `engagement` read — a live-traffic
surface whose router still holds zero-FE-consumer dead code). None is "genuinely still un-flipped with a fully live TS side"
anymore, so no surface can honestly fill this worked example's original role. `engagement` was the
last one to hold it: `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP` is now confirmed live and 8 of its 14
registered read procedures were deleted (myPendingSurveys/getSurveyForResponse/getEnps/
getClimateHeatmap/getLowClimateAlerts/listActionPlans/listLeaderCommitments/getDashboardKpis); the
other 6 (listSurveys/getSurveyResults/getResultsByArea/getWordCloud/getSentiment/getRotationRisk)
were zero-FE-consumer exceptions, deliberately untouched. **UPDATE 2026-08-05 (#56):** two of those
six (`getWordCloud`/`getSentiment`) have since been deleted as well, and so have engagement-write's
last two TS mutations (`createActionPlan`/`updateActionPlan`) — four survivors remain
(`listSurveys`/`getSurveyResults`/`getResultsByArea`/`getRotationRisk`), each kept for a reason
written out in `packages/api/src/routers/engagement.ts`'s header block.
**And `verify engagement` runs a TWO-endpoint check, not six.** The "6-endpoint" figure above was
wrong when written: `scripts/parity/surfaces.ts` registers exactly two engagement endpoints
(`surveys` → `engagement.listSurveys`, `rotation-risk` → `engagement.getRotationRisk`), and
`scripts/parity/surfaces.test.ts:53-58` asserts that exact pair. The other four survivors are by-id
Tier-2 deferrals with no registered endpoint (surfaces.ts's own comment says so). It is still a REAL
check, just a smaller one than this paragraph claimed — see cutover.sh's `engagement` row. The steps
above remain the correct recipe for any FUTURE domain that starts a fresh cutover (Phase 6/7 work,
or a re-opened surface); there just isn't a live example to run today. One DEI caveat, also printed
by `--list`: `dei.getPayEquity` is gated by the separate `Platform:FxReadsEnabled` flag and is NOT
covered by this surface.

## Sequencing safety (the guardrail)

`--flip-backend` refuses to run unless ONE of these is true:

- The **same invocation** also passed `--verify-only` and it passed:
  `./cutover.sh <surface> --verify-only --flip-backend --yes`
- You pass the explicit escape hatch, because you already verified separately (a previous
  invocation, a different terminal, whatever):
  `./cutover.sh <surface> --flip-backend --skip-verify-confirm-i-know-what-im-doing --yes`

`--rollback` has **no such gate** — it is deliberately the fastest, simplest path in the whole
script. If prod looks wrong, you should never have to argue with a safety check to turn a flag back
off.

## Why `aws apprunner update-service`, not Terraform, by default

The Terraform module (`services/Tims.Platform/deploy/terraform/variables.tf`, `feature_flags`
object) only models **9 of the ~24** `Platform:<Surface>Enabled` flags: `external_vendor_read`,
`external_vendor_write`, `billing_read`, `billing_usage`, `billing_webhook_write`,
`billing_self_serve`, `reporting_read`, `validation_staff_write`, `team_intel_read`. It has **no
field at all** for evaluation360, succession, compensation, nine-box, engagement, dei, audit-log,
access-review (read OR write), or the platform dashboard — 9 of this script's 13 read surfaces and
all 6 of its write surfaces. Extending the module (new `optional(bool, false)` fields in `variables.tf` + wiring them
into `main.tf`'s `local.base_env`) is real, deliberate infra work outside this script's scope.

Rather than have the script silently behave differently per surface — Terraform for 4, raw AWS CLI
for the other 14 — `--flip-backend`/`--rollback` always print the direct `aws apprunner
update-service` recipe, which works uniformly for every surface today. For the 4 surfaces the
Terraform module DOES model (`team-intel`, `reporting`, `billing-read`, `billing-usage`) the script
additionally prints the Terraform-based alternative for awareness.

**Known tradeoff:** flipping via the AWS CLI directly drifts Terraform state — a later `terraform
apply` using the checked-in `terraform.tfvars` would try to revert the flag back to its old value.
Mirror any CLI-driven flip into `terraform.tfvars` afterwards, or extend the module first if you
want Terraform to stay authoritative for a given surface.

**Why describe → merge → update, never a partial update:** AWS App Runner's `UpdateService`
**replaces** the entire `RuntimeEnvironmentVariables` map — it does not merge. Flipping exactly one
flag without dropping every other env var (DB connection string, JWT config, all the OTHER flags)
requires reading the current config first, patching just the one key with `jq`, and pushing the
full merged map back. That's exactly the three-step recipe the script prints/runs; there is no
safe single-command "just set this one var" form.

## Full flag-name mapping (surface → `Platform:<Name>Enabled`)

Cross-checked directly against `services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs`
(the authoritative source — every flag there carries a doc-comment citing its Phase-5 slice
number) and independently corroborated by the `flag:` field in `scripts/parity/surfaces.ts` /
`scripts/parity/write-surfaces.ts`.

| Surface (this script) | Kind  | Backend flag                   | Parity CLI invocation                             | FE flag (`apps/web`)                         | Status                                                                      |
| --------------------- | ----- | ------------------------------ | ------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `team-intel`          | read  | `TeamIntelReadEnabled`         | `verify team-intel` (C#-only, re-registered #195) | `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP`      | TS DELETED                                                                  |
| `reporting`           | read  | `ReportingReadEnabled`         | `verify reporting` (C#-only, re-registered #195)  | `NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP`      | TS DELETED                                                                  |
| `billing-read`        | read  | `BillingReadEnabled`           | `NONE` (TS router deleted)                        | `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP`    | TS DELETED                                                                  |
| `billing-usage`       | read  | `BillingUsageEnabled`          | `NONE` (TS router deleted)                        | `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`       | TS DELETED                                                                  |
| `evaluation360`       | read  | `Evaluation360ReadEnabled`     | `verify evaluation360` (C#-only, #195)            | `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP`  | TS DELETED                                                                  |
| `succession`          | read  | `SuccessionReadEnabled`        | `verify succession` (C#-only, #195)               | `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`     | TS DELETED (the old "unregistered — verify is a no-op" note is retired)     |
| `compensation`        | read  | `CompensationReadEnabled`      | `verify compensation`                             | `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP`   | CONFIRMED LIVE (partial TS deletion — 5/7 read procedures, see cutover.sh)  |
| `nine-box`            | read  | `NineBoxReadEnabled`           | `verify ninebox`                                  | `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP`        | TS DELETED (all 11 read procedures; surface kept C#-only — see cutover.sh)  |
| `engagement`          | read  | `EngagementReadEnabled`        | `verify engagement`                               | `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP`     | CONFIRMED LIVE (partial TS deletion — 8/14 read procedures, see cutover.sh) |
| `dei`                 | read  | `DeiReadEnabled`               | `verify dei`                                      | `NEXT_PUBLIC_DEI_READ_VIA_CSHARP`            | TS DELETED (all 11; surface kept C#-only — see cutover.sh)                  |
| `audit-log`           | read  | `AuditLogReadEnabled`          | `verify audit-log`                                | `NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP`      | TS DELETED (surface re-registered C#-only 2026-08-11 — see below)           |
| `access-review`       | read  | `AccessReviewReadEnabled`      | `verify access-review`                            | `NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP`  | TS DELETED (surface re-registered C#-only 2026-08-11 — see below)           |
| `dashboard`           | read  | `PlatformDashboardReadEnabled` | `verify dashboard`                                | `NEXT_PUBLIC_DASHBOARD_READ_VIA_CSHARP`      | BLOCKED (step-5 `verify dashboard` never run, #211 — see cutover.sh)        |
| `fit-engine`          | read  | `FitEngineReadEnabled`         | NONE — surface unregistered (#90)                 | NONE — no FE wrapper shipped (#90)           | BLOCKED (step-5 unrunnable by anyone; no parity fixture — see cutover.sh)   |
| `evaluation360-write` | write | `Evaluation360WriteEnabled`    | `verify-write evaluation360`                      | `NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP` | FLIPPED_AHEAD_OF_FLAG (ownership flipped while dark — see cutover.sh)       |
| `succession-write`    | write | `SuccessionWriteEnabled`       | `verify-write succession`                         | `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP`    | CONFIRMED LIVE                                                              |
| `nine-box-write`      | write | `NineBoxWriteEnabled`          | `verify-write ninebox`                            | `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP`       | CONFIRMED LIVE                                                              |
| `compensation-write`  | write | `CompensationWriteEnabled`     | `verify-write compensation`                       | `NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP`  | COEXISTENCE (flag live; both TS mutations deleted — see cutover.sh)         |
| `engagement-write`    | write | `EngagementWriteEnabled`       | `verify-write engagement`                         | `NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP`    | COEXISTENCE (flag live; 3 of 5 TS mutations deleted — see cutover.sh)       |
| `access-review-write` | write | `AccessReviewWriteEnabled`     | `verify-write access-review`                      | `NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP` | CONFIRMED LIVE (TS deleted; write surface tests C# directly, no TS dep)     |
| `fit-engine-write`    | write | `FitEngineWriteEnabled`        | NONE — surface unregistered (#90)                 | NONE — no FE wrapper shipped (#90)           | BLOCKED (one-active-writer control for fit_scores — see cutover.sh)        |
| `notification`        | read  | `NotificationReadEnabled`      | NONE — surface unregistered (#98)                 | NONE — no FE wrapper shipped (#98)           | BLOCKED (step-5 unrunnable; identity-authorized, needs per-role rows)      |
| `notification-write`  | write | `NotificationWriteEnabled`     | NONE — surface unregistered (#98)                 | NONE — no FE wrapper shipped (#98)           | BLOCKED (router-path writer control only; notify() is outside — cutover.sh)|

Run `./scripts/deploy/cutover.sh --list` for the per-surface long-form notes (why each is
classified the way it is, and every naming quirk below).

### Naming quirks / ambiguities worth knowing about

- **`billing-read` vs `billing-usage` vs `billing-invoices`.** The runbook's prose calls these two
  separate flags under one loose "billing" domain name. `PlatformOptions.cs` and the parity harness
  agree they are genuinely two independent flags (`BillingReadEnabled` / `BillingUsageEnabled`),
  each with its own cutover step. This script keeps them as two separate surfaces
  (`billing-read`, `billing-usage`) rather than folding them together, matching the parity
  harness's own "one flag per surface" convention (see `scripts/parity/surfaces.ts:939-941`).
  UPDATE 2026-07-31: `billing-read`'s TS side (`billing.listInvoices`/`billing.getInvoice`) has
  been deleted, so the parity harness's `billing-invoices` key was removed too (same treatment as
  `team-intel`/`reporting`/`billing-usage` above) — there is no longer a `billing-invoices` parity
  key to map `billing-read` onto; `--verify-only` for this surface is a no-op — and after the 2026-08-17
  #195 re-registrations, billing-read/billing-usage are the LAST TWO rows where that is true.
- **`billing-read`'s FE flag (added 2026-07-28, confirmed live 2026-07-31).**
  `apps/web/lib/platform-api/billing.ts` wires a fourth, independent flag —
  `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` — gating the `useBillingInvoices`/`useBillingInvoice`
  hooks (separate from `BILLING_USAGE_VIA_CSHARP`, which still only covers the other three billing
  reads). The `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` card, wired into
  `settings/billing/page.tsx`, is the first-ever FE consumer of this surface. UPDATE 2026-07-31:
  the flag is confirmed live in prod and both hooks are now C#-only (no TS fallback left) —
  no longer "ships dark."
- **`nine-box` vs `ninebox`.** The parity harness (and the C# route paths, e.g. `/ninebox/grid`)
  spell this with no hyphen. The runbook prose and this script's public surface name use the
  hyphenated `nine-box` for readability; the script maps it to the harness's `ninebox` key
  internally.
- **`team-intel` vs `teamintel`.** Inverted from the nine-box case: the FE flag is
  `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP` (no hyphen inside "teamintel") while everything else
  (`surface.key`, the runbook, this script) uses the hyphenated `team-intel`. Copy-paste the flag
  name from `--list` rather than deriving it from the surface name — it is the one flag in the
  whole set whose casing doesn't follow the `<SURFACE>_..._VIA_CSHARP` pattern literally.
- **`audit-log`, `access-review` (read), and `access-review-write` all post-date the runbook
  doc.** The runbook (`PROD-DEPLOY-RUNBOOK-gate-g3.md`) was last updated 2026-07-23; Slices 17
  (audit-log) and 18 (access-review) merged after that (memory: PRs up to #215, 2026-07-27), so
  neither appears in the doc's own §6 Phase A/B lists. This script's original FLIP-READY
  classification for all three was its own inference (`PlatformOptions.cs` + team memory: merged
  to `main`, dark, code-ready), not a citation of the runbook's Phase A/B lists like every other
  row is. **UPDATE 2026-07-31:** all three have since moved past that inference stage — every flag
  is confirmed live in prod and every TS side is fully deleted (see the table row above and
  cutover.sh's note), so none of them is "probably fine" anymore — they're TS DELETED like
  team-intel/reporting. Every other surface not yet flipped is still in the original "probably
  fine, but nobody has written the official classification down yet" state until the runbook doc
  gets its own update.
- **`reporting` and `evaluation360` (read) have their TS side deleted outright (2026-07-28).** The
  TS recruitment-analytics router and the TS evaluation360 router (plus both routers' FE tRPC
  fallback in `apps/web/lib/platform-api/{reporting,evaluation360}.ts`) were removed once the C#
  read paths were confirmed fully live in prod — see
  `docs/plans/2026-07-28-ts-dead-code-deletion-reporting-eval360.md`. `scripts/parity/surfaces.ts`'s
  `reporting` and `evaluation360` entries were removed at the same time, so there is no TS side left
  to diff against for either read surface. (UPDATE 2026-08-17, #195: both entries were RE-REGISTERED
  C#-only, `parity_command` is `verify` again, and `--verify-only` is a real gate — the no-op era
  ran 2026-07-28 → 2026-08-17.) **`team-intel` (read) joined this group on 2026-07-29** —
  but unlike `reporting`/`evaluation360`, only the `getDashboardKpis` procedure inside
  `packages/api/src/routers/teamIntel.ts` (plus its FE tRPC fallback in
  `apps/web/lib/platform-api/team-intel.ts`) was deleted at first, not the whole router — it then
  still served 6 other zero-FE-consumer procedures (`getTeamProfile`, `getMembers`,
  `getBalanceScore`, `getBalanceAlerts`, `getRecommendedHires`, `compareTeams`). (UPDATE
  2026-08-06, #55: those 6 were deleted too and `teamIntel.ts` is GONE — see cutover.sh's
  team-intel row.) `scripts/parity/surfaces.ts`'s `team-intel` entry was removed the same
  way. (UPDATE 2026-08-17, #195: re-registered C#-only with FIVE endpoints — the two 501 stubs
  excluded, see the surfaces.ts header — so `--verify-only` is a real gate for it too.) This
  does NOT touch the `evaluation360-write` surface —
  `scripts/parity/write-surfaces.ts` still registers `evaluation360` for `verify-write` (it tests
  the C# API's RBAC/IDOR behavior directly, not a TS diff), so that row's parity command is
  unaffected and still real. The `evaluation360-write` row's note used to say "once verified, drop
  the TS eval360 router" as a pending step — that deletion already happened (both read AND write TS
  code are gone), independent of whether the write flag itself has been flipped yet.
  **`access-review` (both read and write) joined this group on 2026-07-31** — all 3 registered TS
  read procedures (`getAccessReview`/`exportAccessReviewCsv`/`listAccessReviewAttestations`) AND
  the write procedure (`attestAccessReview`) were deleted; with zero procedures left, the whole
  router file (`packages/api/src/routers/platform/access-review.ts` + its schemas/service/
  repository) was removed outright, matching the `reporting` precedent, unlike `team-intel`'s
  partial survival. **`audit-log` (read) also joined this group on 2026-07-31** — its flag was
  confirmed live in prod and its only registered read procedure (`platform.getCrossOrgAuditLogs`,
  plus `platform.exportAuditLogsCsv` which shared the same TS router) was deleted from
  `packages/api/src/routers/platform/system.ts`. Unlike `team-intel`, the FE wrapper
  (`apps/web/lib/platform-api/audit-log.ts`) also lost its flag-gating entirely — it now calls the
  C# service unconditionally, the same shape as `reporting`/`evaluation360`/`team-intel`'s
  wrappers.
- **CORRECTION + UPDATE 2026-08-11 — the two access-review/audit-log rows are NOT no-ops any more,
  and one claim above was never true.** The paragraph above used to end by saying that
  `scripts/parity/surfaces.ts`'s `access-review` entry _and_
  `scripts/parity/write-surfaces.ts`'s `access-review` **write** entry "were both removed the same
  way, so `--verify-only` for either access-review row is now a no-op". The write half of that was
  false when written: `WRITE_SURFACES['access-review']` has never been removed (it is still in
  `write-surfaces.ts`, still asserted by `write-surfaces.test.ts`, and `--list` has shown
  `verify-write access-review` for that row throughout). It tests the C# endpoint directly via raw
  SQL + HTTP and has no `tsProcedure` concept at all, so a TS deletion could not have affected it.
  The READ half was true — and is now reversed. Both READ surfaces were **re-registered C#-only on
  2026-08-11**, because `tsProcedure` became optional on 2026-08-06 (`efb7553f`), six days after
  they were deleted. So `--verify-only` for `audit-log` and `access-review` runs a real check again.
  **Read its output precisely:** the parity leg reports `[WEAK]` on every endpoint (no TS side to
  diff against — that part of the 2026-07-31 note still holds), while the RBAC leg
  (`platform_owner` 200 / `org_admin` 403 at `PlatformOwnerGate`) and the C#-returns-200 liveness
  check are real, and on a principal-type gate the RBAC leg is the entire authorization proof. The
  RLS leg is a documented N/A on both surfaces (`globalScope`) — it was N/A before the deletion too,
  so no cross-tenant probe was lost then or regained now. `/audit/logs/export` is registered for the
  first time; the pre-deletion entry covered only `/audit/logs`.
- **Write-surface names use an explicit `-write` suffix** (`access-review-write`,
  `evaluation360-write`, etc.) to keep them addressable independently from their read counterpart
  — a domain's read and write flags cut over at different points in the runbook's Phase A / Phase B
  ordering and have completely independent `verify` vs `verify-write` parity commands, so treating
  "reporting" and "reporting-write" (hypothetically) as the same script argument would be wrong.
  Only evaluation360/succession/nine-box/compensation/engagement/access-review actually have a
  write flag today — `team-intel`, `reporting`, `billing-read`, `billing-usage`, `dei`, and
  `audit-log` are read-only surfaces in this migration wave (no corresponding write flag exists in
  `PlatformOptions.cs`), so `dei-write` etc. are deliberately NOT registered surface names.

## Requirements per mode

- `--verify-only`: `scripts/parity/.env` populated (Supabase creds — see `scripts/parity/.env.example`
  and `scripts/parity/README.md`), plus a live, reachable C# service and TS app. None of that
  exists in a dev sandbox; this is the mode Federico runs against real prod/staging.
- `--flip-backend --yes` / `--rollback --yes`: `aws` and `jq` on `PATH`, valid AWS credentials for
  the target account, and either `--service-arn <arn>` or `$TIMS_APPRUNNER_SERVICE_ARN` set. Without
  `--yes` neither of these is needed — the script only prints the commands.

Run `./scripts/deploy/cutover.sh --help` for the full flag reference.
