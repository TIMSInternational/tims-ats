# `cutover.sh` — per-domain flip-and-verify automation

One generic script for the C# strangler-fig production cutover of the **standard** domains (the
ones using the normal staff-JWT/browser-cookie auth pattern). It wraps the recipe in
[`docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md`](../../docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md)
§6 so cutting a surface over is a couple of copy-pasteable commands instead of ten bespoke
runbooks.

**Out of scope, on purpose:** `external-vendor`, `billing-webhook`, and `billing-self-serve` use a
different auth mechanism (API keys / Stripe webhooks, not staff-JWT) and are handled by a separate
workstream — they are deliberately absent from this script's surface table.

**Who runs what.** Same rule as the runbook: `--verify-only` is genuinely safe for anyone to run
(it only reads, via the parity harness). `--flip-backend`/`--rollback` with `--yes` touches real
AWS infrastructure — that is **Federico-run only** (`I never touch prod`, applies to whoever is at
the keyboard, human or agent). Without `--yes` both modes only print the commands; nothing is
executed.

## The three modes

| Mode             | Mutates anything? | What it does                                                                                                 |
| ---------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `--verify-only`  | No (default)      | Runs `scripts/parity/cli.ts verify[-write] <key>` for real and reports pass/fail.                            |
| `--flip-backend` | Only with `--yes` | Prints (or runs) the `aws apprunner update-service` recipe that flips `Platform:<Surface>Enabled` to `true`. |
| `--rollback`     | Only with `--yes` | Same recipe, flips the flag back to `false`, plus prints the FE Vercel-revert steps.                         |

Run `./scripts/deploy/cutover.sh --list` for the full surface table (flag name, parity CLI key, FE
flag, and CONFIRMED LIVE / FLIP-READY / COEXISTENCE / TS DELETED status per
[the runbook's §6 classification](../../docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md#6-per-surface-cutover-one-flag-at-a-time-ts-stays-until-prod-verified)).

## Worked example: cutting over `engagement`

```bash
# 1) Verify — safe, non-mutating, needs scripts/parity/.env populated (see scripts/parity/README.md)
#    and a live, reachable C# service.
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

**Why `engagement` and not one of the other surfaces?** A worked example is only honest on a surface
that is genuinely still un-flipped AND still has a live TS side to verify against. As of 2026-07-31
most surfaces fail one half or the other. `reporting`, `evaluation360` (read), `team-intel` and
`billing-usage` had their TS routers/procedures deleted outright (the C# read path is the sole
implementation now — each time only the specific dead procedure(s) were removed, so team-intel's and
billing.ts's routers stay alive for their other, still-dark-or-unrelated procedures), so
`--verify-only` for any of them is a no-op that prints an explanatory notice and exits 0 rather than
running a real check. `succession`, `nine-box`, `compensation`, and now `dei` are already CONFIRMED
LIVE in prod with their TS side partially deleted, so "flip the flag" and "roll back" no longer
describe reality for them — `dei` held this walkthrough until 2026-07-31, when 8 of its 10 registered
read procedures were deleted (only getEthnicityDistribution/getDisabilityDistribution, both
zero-FE-consumer exceptions, still have a TS side). `engagement` read is the cleanest remaining
demonstration: `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP` does not exist in Vercel yet, the whole TS
engagement router's reads are live (its 2026-07-29 TS deletion touched ONLY the WRITE side, 3 of 5
mutations — `engagement-write` itself is therefore now a partial-TS-deletion surface, but that does
not affect the read worked example), and `verify engagement` runs a real 9-endpoint parity/RLS/RBAC
check (5 by-id reads deferred — see surfaces.ts). DEI's own caveat, also printed by `--list`:
`dei.getPayEquity` was gated by the separate `Platform:FxReadsEnabled` flag but shared DEI's ONE FE
flag, so its TS side was deleted in the same pass as the other 8 despite that backend-flag split.

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
or access-review (read OR write) — 8 of this script's 12 read surfaces and all 6 of its write
surfaces. Extending the module (new `optional(bool, false)` fields in `variables.tf` + wiring them
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

| Surface (this script) | Kind  | Backend flag                | Parity CLI invocation        | FE flag (`apps/web`)                         | Status                                                                      |
| --------------------- | ----- | --------------------------- | ---------------------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `team-intel`          | read  | `TeamIntelReadEnabled`      | `NONE` (TS router deleted)   | `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP`      | TS DELETED                                                                  |
| `reporting`           | read  | `ReportingReadEnabled`      | `NONE` (TS router deleted)   | `NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP`      | TS DELETED                                                                  |
| `billing-read`        | read  | `BillingReadEnabled`        | `verify billing-invoices`    | `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP`    | FLIP-READY                                                                  |
| `billing-usage`       | read  | `BillingUsageEnabled`       | `NONE` (TS router deleted)   | `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP`       | TS DELETED                                                                  |
| `evaluation360`       | read  | `Evaluation360ReadEnabled`  | `NONE` (TS router deleted)   | `NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP`  | TS DELETED                                                                  |
| `succession`          | read  | `SuccessionReadEnabled`     | `verify succession`          | `NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP`     | CONFIRMED LIVE (partial TS deletion — 8/9 procedures, see cutover.sh)       |
| `compensation`        | read  | `CompensationReadEnabled`   | `verify compensation`        | `NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP`   | CONFIRMED LIVE (partial TS deletion — 5/7 read procedures, see cutover.sh)  |
| `nine-box`            | read  | `NineBoxReadEnabled`        | `verify ninebox`             | `NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP`        | CONFIRMED LIVE (partial TS deletion — 7/11 read procedures, see cutover.sh) |
| `engagement`          | read  | `EngagementReadEnabled`     | `verify engagement`          | `NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP`     | FLIP-READY                                                                  |
| `dei`                 | read  | `DeiReadEnabled`            | `verify dei`                 | `NEXT_PUBLIC_DEI_READ_VIA_CSHARP`            | FLIP-READY                                                                  |
| `audit-log`           | read  | `AuditLogReadEnabled`       | `verify audit-log`           | `NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP`      | FLIP-READY                                                                  |
| `access-review`       | read  | `AccessReviewReadEnabled`   | `verify access-review`       | `NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP`  | FLIP-READY                                                                  |
| `evaluation360-write` | write | `Evaluation360WriteEnabled` | `verify-write evaluation360` | `NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP` | FLIP-READY                                                                  |
| `succession-write`    | write | `SuccessionWriteEnabled`    | `verify-write succession`    | `NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP`    | CONFIRMED LIVE                                                              |
| `nine-box-write`      | write | `NineBoxWriteEnabled`       | `verify-write ninebox`       | `NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP`       | CONFIRMED LIVE                                                              |
| `compensation-write`  | write | `CompensationWriteEnabled`  | `verify-write compensation`  | `NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP`  | COEXISTENCE (flag live; both TS mutations deleted — see cutover.sh)         |
| `engagement-write`    | write | `EngagementWriteEnabled`    | `verify-write engagement`    | `NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP`    | COEXISTENCE (flag live; 3 of 5 TS mutations deleted — see cutover.sh)       |
| `access-review-write` | write | `AccessReviewWriteEnabled`  | `verify-write access-review` | `NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP` | FLIP-READY                                                                  |

Run `./scripts/deploy/cutover.sh --list` for the per-surface long-form notes (why each is
classified the way it is, and every naming quirk below).

### Naming quirks / ambiguities worth knowing about

- **`billing-read` vs `billing-usage` vs `billing-invoices`.** The runbook's prose calls these two
  separate flags under one loose "billing" domain name. `PlatformOptions.cs` and the parity harness
  agree they are genuinely two independent flags (`BillingReadEnabled` / `BillingUsageEnabled`),
  each with its own cutover step. This script keeps them as two separate surfaces
  (`billing-read`, `billing-usage`) rather than folding them together, matching the parity
  harness's own "one flag per surface" convention (see `scripts/parity/surfaces.ts:939-941`). The
  parity CLI's registered key for the invoice-read surface is `billing-invoices`, not
  `billing-read` — this script accepts the friendlier `billing-read` name and maps it internally so
  the CLI-facing vocabulary matches the runbook's prose.
- **`billing-read` now has an FE flag too (2026-07-28).** `apps/web/lib/platform-api/billing.ts`
  wires a fourth, independent flag — `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` — gating the
  `useBillingInvoices`/`useBillingInvoice` hooks (separate from `BILLING_USAGE_VIA_CSHARP`, which
  still only covers the other three billing reads). The new
  `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` card, wired into
  `settings/billing/page.tsx`, is the first-ever FE consumer of this surface. It ships dark
  (unset/false) exactly like every other surface's default-off convention — this is now a real
  single-flag flip candidate like the rest of the table, not an exception.
- **`nine-box` vs `ninebox`.** The parity harness (and the C# route paths, e.g. `/ninebox/grid`)
  spell this with no hyphen. The runbook prose and this script's public surface name use the
  hyphenated `nine-box` for readability; the script maps it to the harness's `ninebox` key
  internally.
- **`team-intel` vs `teamintel`.** Inverted from the nine-box case: the FE flag is
  `NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP` (no hyphen inside "teamintel") while everything else
  (`surface.key`, the runbook, this script) uses the hyphenated `team-intel`. Copy-paste the flag
  name from `--list` rather than deriving it from the surface name — it is the one flag in the
  whole set whose casing doesn't follow the `<SURFACE>_..._VIA_CSHARP` pattern literally.
- **`audit-log` and `access-review` (both read and write) post-date the runbook doc.** The runbook
  (`PROD-DEPLOY-RUNBOOK-gate-g3.md`) was last updated 2026-07-23; Slices 17 (audit-log) and 18
  (access-review) merged after that (memory: PRs up to #215, 2026-07-27), so neither appears in the
  doc's own §6 Phase A/B lists. This script classifies both as FLIP-READY based on
  `PlatformOptions.cs` + team memory (merged to `main`, dark, code-ready) — but that classification
  is this script's own inference, not a citation of the runbook's Phase A/B lists like every other
  row is. Treat these two as "probably fine, but nobody has written the official classification
  down yet" until the runbook doc gets its own update.
- **`reporting` and `evaluation360` (read) have their TS side deleted outright (2026-07-28).** The
  TS recruitment-analytics router and the TS evaluation360 router (plus both routers' FE tRPC
  fallback in `apps/web/lib/platform-api/{reporting,evaluation360}.ts`) were removed once the C#
  read paths were confirmed fully live in prod — see
  `docs/plans/2026-07-28-ts-dead-code-deletion-reporting-eval360.md`. `scripts/parity/surfaces.ts`'s
  `reporting` and `evaluation360` entries were removed at the same time, so there is no TS side left
  to diff against for either read surface: their `parity_command` is `NONE` and `--verify-only`
  just prints a no-op notice and exits 0. **`team-intel` (read) joined this group on 2026-07-29** —
  but unlike `reporting`/`evaluation360`, only the `getDashboardKpis` procedure inside
  `packages/api/src/routers/teamIntel.ts` (plus its FE tRPC fallback in
  `apps/web/lib/platform-api/team-intel.ts`) was deleted, not the whole router: `teamIntel.ts` still
  serves 6 other unrelated procedures (`getTeamProfile`, `getMembers`, `getBalanceScore`,
  `getBalanceAlerts`, `getRecommendedHires`, `compareTeams`) with zero FE consumers, so the router
  file itself stays in place. `scripts/parity/surfaces.ts`'s `team-intel` entry was removed the same
  way, so its `parity_command` is likewise `NONE` and `--verify-only` for it is the same no-op. This
  does NOT touch the `evaluation360-write` surface —
  `scripts/parity/write-surfaces.ts` still registers `evaluation360` for `verify-write` (it tests
  the C# API's RBAC/IDOR behavior directly, not a TS diff), so that row's parity command is
  unaffected and still real. The `evaluation360-write` row's note used to say "once verified, drop
  the TS eval360 router" as a pending step — that deletion already happened (both read AND write TS
  code are gone), independent of whether the write flag itself has been flipped yet.
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
