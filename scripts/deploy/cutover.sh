#!/usr/bin/env bash
# scripts/deploy/cutover.sh — per-domain "flip and verify" automation for the C# strangler-fig
# production cutover (docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md §6).
#
# SCOPE: the ~10 STANDARD domains that use the normal staff-JWT/browser-cookie auth pattern —
# team-intel, reporting, billing-read, billing-usage, evaluation360, succession, compensation,
# nine-box, engagement, dei, audit-log, access-review (12 read/write-pair domains once the
# read+write flags are counted separately — see --list). external-vendor, billing-webhook, and
# billing-self-serve are OUT OF SCOPE (different auth mechanisms; separate workstream) and are
# deliberately absent from the surface table below.
#
# SAFETY MODEL (mirrors the runbook's "Federico-run" rule — nothing here touches AWS/prod unless
# a human explicitly opts in):
#   --verify-only   (DEFAULT) runs the real parity CLI (`scripts/parity/cli.ts verify[-write]`).
#                   Safe, non-mutating, genuinely runnable today given creds + a live C# service.
#   --flip-backend  prints the exact `aws apprunner update-service` recipe that would flip the
#                   `Platform:<Surface>Enabled` flag to true. DRY-RUN (print only) unless --yes.
#   --rollback      same shape, flips the flag back to `false` + prints the FE Vercel revert
#                   steps. DRY-RUN (print only) unless --yes. No verify-first gate — rollback is
#                   deliberately the fastest, simplest path in this script.
#   --list          prints the full surface table (flag name + parity key + FE flag + status).
#
# Sequencing safety: --flip-backend refuses to run unless this SAME invocation also ran
# --verify-only (and it passed), or the --skip-verify-confirm-i-know-what-im-doing escape hatch
# was passed. This is the guardrail against "flip without ever having verified."
#
# See scripts/deploy/README-cutover.md for the worked example + full flow.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PARITY_CLI="scripts/parity/cli.ts"

# ---------------------------------------------------------------------------------------------
# Surface catalog — the single source of truth this script maps a CLI-friendly surface name to.
#
# Fields (pipe-delimited): kind|flag|parity_command|parity_key|fe_flag|status|note
#   kind           "read" or "write"
#   flag           the exact PlatformOptions.cs property name (Platform__<flag> is the App Runner
#                  env var; Platform:<flag> is the config-section notation used in docs)
#   parity_command "verify" (read surfaces, scripts/parity/surfaces.ts SURFACES) or "verify-write"
#                  (write surfaces, scripts/parity/write-surfaces.ts WRITE_SURFACES), or the
#                  literal string NONE when no TS side exists to diff against at all (the TS
#                  router was deleted outright — see reporting/evaluation360 below)
#   parity_key     the key registered in that file — NOT always identical to our surface name
#                  (see billing-read -> billing-invoices, nine-box -> ninebox below), or NONE
#                  when parity_command is NONE
#   fe_flag        the NEXT_PUBLIC_*_VIA_CSHARP flag wired in apps/web/lib/platform-api/*.ts, or
#                  the literal string NONE when no such flag exists in the repo today
#   status         CONFIRMED_LIVE | FLIP_READY | COEXISTENCE | BLOCKED | TS_DELETED — see --list
#                  for the human-readable note attached to each
#
# Cross-checked directly against:
#   services/Tims.Platform/src/Tims.Api/Configuration/PlatformOptions.cs   (flag names — the
#     authoritative source; comments there cite the exact Slice number for each)
#   scripts/parity/surfaces.ts / write-surfaces.ts                        (parity CLI surface keys
#     + `flag:` fields, which independently corroborate the PlatformOptions.cs names)
#   apps/web/lib/platform-api/*.ts                                        (FE flag names)
#   docs/architecture/csharp-migration/PROD-DEPLOY-RUNBOOK-gate-g3.md §6  (Phase A/B classification)
# ---------------------------------------------------------------------------------------------
surface_row() {
  case "$1" in
    team-intel)
      echo "read|TeamIntelReadEnabled|NONE|NONE|NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP|TS_DELETED|Runbook intro + §6 Phase A #1. UPDATE 2026-07-29: the TS getDashboardKpis procedure (packages/api/src/routers/teamIntel.ts) and its FE tRPC fallback (apps/web/lib/platform-api/team-intel.ts) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'team-intel' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. NOTE: teamIntel.ts's other 6 procedures (getTeamProfile, getMembers, getBalanceScore, getBalanceAlerts, getRecommendedHires, compareTeams) are untouched — they have zero FE consumers and were never part of the C# cutover."
      ;;
    reporting)
      echo "read|ReportingReadEnabled|NONE|NONE|NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #2. UPDATE 2026-07-28: the TS recruitment-analytics router (packages/api/src/routers/recruitment-analytics.ts) and its FE tRPC fallback (apps/web/lib/platform-api/reporting.ts) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'reporting' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check."
      ;;
    billing-read)
      echo "read|BillingReadEnabled|NONE|NONE|NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #3 (part 1). UPDATE 2026-07-31: the flag is confirmed live in prod (parity-verified fresh 5/5 PASS immediately before flipping), and the TS listInvoices/getInvoice procedures (packages/api/src/routers/billing.ts) and their FE tRPC fallback (apps/web/lib/platform-api/billing.ts's useBillingInvoices/useBillingInvoice hooks, backing apps/web/app/(admin)/settings/billing/billing-invoices.tsx) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'billing-invoices' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check."
      ;;
    billing-usage)
      echo "read|BillingUsageEnabled|NONE|NONE|NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #3 (part 2). UPDATE 2026-07-29: the TS getBillingConfig/getCurrentPlan/getUsage procedures (packages/api/src/routers/billing.ts) and their FE tRPC fallback (apps/web/lib/platform-api/billing.ts) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'billing-usage' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. NOTE: billing.ts's other 5 hooks (useBillingInvoices, useBillingInvoice, and the 3 self-serve write mutations) are untouched — separate flags, both still dark."
      ;;
    evaluation360)
      echo "read|Evaluation360ReadEnabled|NONE|NONE|NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #4. UPDATE 2026-07-28: the TS evaluation360 router (packages/api/src/routers/evaluation360.ts) and its FE tRPC fallback (apps/web/lib/platform-api/evaluation360.ts, both read AND write) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'evaluation360' entry was removed too and there is no TS side left to diff against for reads. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. NOTE: the WRITE surface is unaffected by this — see the evaluation360-write row below; scripts/parity/write-surfaces.ts still registers 'evaluation360' for verify-write."
      ;;
    succession)
      echo "read|SuccessionReadEnabled|NONE|NONE|NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 8 of 9 registered read procedures (all but getCriticalRole, which has zero FE consumers) had their TS side deleted. UPDATE 2026-08-03 (#58): getCriticalRole — the 9th and last — is now deleted too, and with it the whole TS router (packages/api/src/routers/succession.ts is GONE, unregistered from root.ts). scripts/parity/surfaces.ts's 'succession' entry was therefore REMOVED and --verify-only for this surface is now a NO-OP, exactly like reporting/evaluation360/team-intel/billing-usage. This row flipped CONFIRMED_LIVE → TS_DELETED and verify → NONE: the previous note explicitly said 'do not treat this as TS_DELETED', which is no longer true. Do NOT read a green run as evidence about the C# read surface — that coverage now lives in SuccessionReadTests.cs / SuccessionReadEndpointAuthTests.cs. NOTE: the WRITE surface is unaffected — see the succession-write row below."
      ;;
    compensation)
      echo "read|CompensationReadEnabled|verify|compensation|NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 5 of 7 registered read procedures (salary-bands, benefits-utilization, compa-ratio-distribution, pending-adjustments, my-compensation) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'compensation' entry now registers only market-comparison + employee (both zero-FE-consumer procedures that stay live). --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED. UPDATE 2026-07-31: the 3 FE-consumed FX-dependent reads (getBandDistribution/getTotalCompBreakdown/getDashboardKpis), never part of this surface's registered endpoints (gated by the separate Platform__FxReadsEnabled + NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP), have now had their TS side deleted too — that flag is confirmed permanently live in prod (parity-verified 10/10 PASS), closing the FX carve-out. Their TS implementations were never registered in scripts/parity/surfaces.ts and stay unregistered (there is no TS side left to diff against)."
      ;;
    nine-box)
      echo "read|NineBoxReadEnabled|verify|ninebox|NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP|TS_DELETED|Runbook §6 Phase A #4. UPDATE 2026-07-29: flag confirmed live in prod; 7 of 11 registered read procedures had their TS side deleted. UPDATE 2026-08-05 (#57): the last 4 (getAxisBreakdown, getMovementHistory, simulate, getQuadrantPlan — all zero-FE-consumer) are now deleted too, and with them the whole TS router (packages/api/src/routers/ninebox.ts + .schemas.ts + .helpers.ts are GONE, unregistered from root.ts). Status is TS_DELETED, but verify stays 'verify ninebox' and the surface stays REGISTERED as C#-only: only checks/parity.ts reads tsProcedure, so dropping the surface would have retired the RLS Mode-A cross-tenant IDOR probe and the RBAC deny assertions against 11 still-deployed C# endpoints — a security-coverage regression, not a cleanup. A run now reports [WEAK] for parity (no TS side to compare, stated explicitly) while RLS + RBAC run for real and still fail the command. Read a green run as evidence about ISOLATION and PERMISSIONS on the C# read surface, NOT as cross-stack parity. NOTE: the WRITE surface is unaffected — see the ninebox-write row below."
      ;;
    engagement)
      echo "read|EngagementReadEnabled|verify|engagement|NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-31: flag confirmed live in prod (first flip attempt caught a real parity-harness fixture gap, fixed in commit 7fd23a7, then re-verified 43/43 PASS and re-flipped for real); 7 of 9 registered read procedures (all but listSurveys and getRotationRisk, which have zero FE wrapper consumers) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'engagement' entry now registers only listSurveys + getRotationRisk's endpoints. --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED."
      ;;
    dei)
      echo "read|DeiReadEnabled|verify|dei|NEXT_PUBLIC_DEI_READ_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase A #4. UPDATE 2026-07-31: flag confirmed live in prod; 9 of 11 registered read procedures (all but getEthnicityDistribution/getDisabilityDistribution, which have zero FE consumers) have ALSO had their TS side deleted — scripts/parity/surfaces.ts's 'dei' entry now registers only those 2 zero-consumer procedures' endpoints. --verify-only still runs a REAL (smaller) check, unlike reporting/evaluation360/team-intel/billing-usage's now-fully-no-op surfaces — do not treat this as TS_DELETED. getPayEquity (FX) was gated by the separate Platform:FxReadsEnabled backend flag but shared this ONE FE flag, so its TS side was deleted in the same pass as the other 8 despite that backend split."
      ;;
    audit-log)
      echo "read|AuditLogReadEnabled|NONE|NONE|NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP|TS_DELETED|Phase-5 Slice-17. UPDATE 2026-07-31: flag confirmed live in prod, and this surface's only registered read procedure (platform.getCrossOrgAuditLogs, plus platform.exportAuditLogsCsv which shared the same TS router) has been deleted (packages/api/src/routers/platform/system.ts) — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'audit-log' entry was removed too and there is no TS side left to diff against. The FE wrapper (apps/web/lib/platform-api/audit-log.ts) now calls the C# service unconditionally rather than gating on the flag. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check."
      ;;
    access-review)
      echo "read|AccessReviewReadEnabled|NONE|NONE|NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP|TS_DELETED|Phase-5 Slice-18. UPDATE 2026-07-31: flag confirmed live in prod; all 3 registered TS read procedures (getAccessReview/exportAccessReviewCsv/listAccessReviewAttestations) have been deleted — the C# read path is the sole implementation now, so scripts/parity/surfaces.ts's 'access-review' entry was removed too and there is no TS side left to diff against. --verify-only for this surface is now a no-op (see run_verify) rather than a real parity check. UPDATE (same day, continued): the write flag (access-review-write) was ALSO confirmed live and its TS side deleted the same session — with BOTH sides gone, the whole TS router (packages/api/src/routers/platform/access-review.ts + its schemas/service/repository) was removed outright, matching the team-intel/reporting precedent, unlike this entry's original note. Read side is efcoreReadOnly over Phase-2 identity tables (users/roles/user_roles/role_permissions/permissions/organizations); access_reviews itself stays Prisma-owned (the C# write is a coexistence write, not an ownership flip — see table-ownership.md)."
      ;;
    evaluation360-write)
      echo "write|Evaluation360WriteEnabled|verify-write|evaluation360|NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #8 — FLIP-READY. UPDATE 2026-07-28: this note used to say 'once verified, drop the TS eval360 router' as a pending future step — that's now DONE (packages/api/src/routers/evaluation360.ts + its FE fallback in apps/web/lib/platform-api/evaluation360.ts were deleted outright), independent of this flag's flip state. verify-write itself is UNAFFECTED by that deletion (scripts/parity/write-surfaces.ts's 'evaluation360' entry hits the C# API directly for RBAC/IDOR checks — it never depended on the TS router). Flipping Platform:Evaluation360WriteEnabled is still the pending step to move review_cycles/rater_assignments/rater_responses to efcore table-ownership."
      ;;
    succession-write)
      echo "write|SuccessionWriteEnabled|verify-write|succession|NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase B #9. UPDATE 2026-07-29: flag confirmed live in prod. 2 of 5 mutations (addSuccessor, updateCriticalRoleBand) have had their TS side deleted; the other 3 (addCriticalRole, removeSuccessor, updateSuccessorReadiness) have zero FE consumers and are untouched, unrelated dead code. UPDATE 2026-08-03 (#58): those 3 are now DELETED as well, so all 5 succession writes are C#-only and the TS router no longer exists at all — C# is the sole writer of critical_roles + successors from the application path (prisma/seed-demo.ts still writes both, but it is a local demo seeder, not a runtime path). scripts/parity/write-surfaces.ts's successionSurface tests the C# HTTP endpoints directly regardless of TS state — verify-write is fully unaffected either way and still runs a REAL check on all 5."
      ;;
    nine-box-write)
      echo "write|NineBoxWriteEnabled|verify-write|ninebox|NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP|CONFIRMED_LIVE|Runbook §6 Phase B #10. UPDATE 2026-07-29: flag confirmed live in prod. 3 of 5 mutations (createCalibration, addCalibrationMember, removeCalibrationMember) have had their TS side deleted; the other 2 (submitCalibrationVote, finalizeCalibration) had zero FE consumers and were left in place. UPDATE 2026-08-05 (#57): those last 2 are now deleted too — C# is the ONLY application writer of calibration_sessions / calibration_members / calibration_votes, which is the write-side precondition for ownership flip #70. scripts/parity/write-surfaces.ts's nineboxSurface tests the C# HTTP endpoints directly regardless of TS state — verify-write is fully unaffected either way and stays a REAL check on all 5 writes."
      ;;
    compensation-write)
      echo "write|CompensationWriteEnabled|verify-write|compensation|NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #11 — COEXISTENCE: salary_adjustments/employee_compensations stay read by other surfaces; table stays efcoreStranglerWrite, no ownership flip. UPDATE 2026-07-29: the flag IS confirmed live in prod and both TS mutations (createAdjustment/approveAdjustment) have now been DELETED — but the status stays COEXISTENCE, not CONFIRMED_LIVE, because COEXISTENCE classifies TABLE OWNERSHIP and that reason is MORE true after the deletion: employee_compensations is still read in TypeScript by getTotalCompBreakdown/getDashboardKpis/getPayEquity/simulateAdjustment (two of which are the still-TS-served FX reads). verify-write is unaffected either way — write-surfaces.ts's compensationSurface hits the C# HTTP endpoints directly and asserts side effects with raw SQL, never via the TS router."
      ;;
    engagement-write)
      echo "write|EngagementWriteEnabled|verify-write|engagement|NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #12 — the flag flip itself is documented as canary-safe (byte-identical rows both stacks), and COEXISTENCE describes the terminal state. UPDATE 2026-07-29: the flag IS confirmed live in prod and 3 of the 5 TS mutations (createSurvey/activateSurvey/submitSurveyResponse) have now been DELETED; the other 2 (createActionPlan/updateActionPlan) have zero FE consumers and are untouched, unrelated dead code. This note previously ended '...so the TS router can't be deleted yet' — that clause was a NON-SEQUITUR and has been struck: COEXISTENCE classifies TABLE OWNERSHIP, not TS-code existence. The accurate reasoning is two separate facts: (a) the TS engagement ROUTER stays alive because 6 zero-wrapper reads (listSurveys/getSurveyResults/getResultsByArea/getWordCloud/getSentiment/getRotationRisk) + 2 zero-consumer mutations still live in it (UPDATE 2026-07-31: the other 8 reads' TS procedures were deleted once NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP went live in prod — see the engagement row above — but that doesn't empty the router); and (b) surveys/survey_responses/action_plans stay efcoreStranglerWrite because monitoring.ts/dei.ts/the alert-evaluation repository still read them via Prisma. verify-write is unaffected either way — write-surfaces.ts's engagementSurface hits the C# HTTP endpoints directly and asserts side effects with raw SQL, never via the TS router."
      ;;
    access-review-write)
      echo "write|AccessReviewWriteEnabled|verify-write|access-review|NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP|CONFIRMED_LIVE|Phase-5 Slice-18 write. UPDATE 2026-07-31: flag confirmed live in prod (parity-verified fresh 3/3 PASS immediately before flipping) and the TS side of the single attest mutation (attestAccessReview/attest()/insertAttestation/orgExists) has been DELETED outright — C# is now the sole writer of access_reviews, nothing else wrote it before or since. Unlike compensation-write/engagement-write this is COMPLETE, not partial (one mutation, fully ported), so CONFIRMED_LIVE (not COEXISTENCE) matches the succession-write/nine-box-write convention. verify-write is unaffected either way — write-surfaces.ts's accessReviewSurface hits the C# HTTP endpoints directly, never via the TS router."
      ;;
    *)
      return 1
      ;;
  esac
}

ALL_SURFACES="team-intel reporting billing-read billing-usage evaluation360 succession compensation nine-box engagement dei audit-log access-review evaluation360-write succession-write nine-box-write compensation-write engagement-write access-review-write"

field() {
  # field <pipe-delimited-row> <index 1-based>
  echo "$1" | cut -d'|' -f"$2"
}

status_label() {
  case "$1" in
    CONFIRMED_LIVE) echo "CONFIRMED LIVE" ;;
    FLIP_READY) echo "FLIP-READY" ;;
    COEXISTENCE) echo "COEXISTENCE" ;;
    BLOCKED) echo "BLOCKED" ;;
    TS_DELETED) echo "TS DELETED (no parity)" ;;
    *) echo "$1" ;;
  esac
}

usage() {
  cat <<'EOF'
Usage: scripts/deploy/cutover.sh <surface> [MODE] [OPTIONS]
       scripts/deploy/cutover.sh --list
       scripts/deploy/cutover.sh --help

MODES (default: --verify-only)
  --verify-only              Run the real parity CLI (`verify`/`verify-write`) for <surface> and
                              report pass/fail. Non-mutating. Needs scripts/parity/.env populated
                              (Supabase creds) + a live, reachable C# service — see
                              scripts/parity/README.md. Safe to run today with zero risk.

  --flip-backend              Print (default) or run (--yes) the exact `aws apprunner
                              update-service` recipe that flips Platform:<Surface>Enabled to
                              `true`. Refuses to run unless this SAME invocation also passed
                              --verify-only (and it passed), or you pass
                              --skip-verify-confirm-i-know-what-im-doing.

  --rollback                  Print (default) or run (--yes) the recipe that flips the SAME flag
                              back to `false`, plus print the FE Vercel-revert instructions. No
                              verify-first gate — this is the deliberately-fast path.

OPTIONS
  --yes                       Actually execute the AWS CLI calls for --flip-backend/--rollback
                              instead of printing them. Requires TIMS_APPRUNNER_SERVICE_ARN (or
                              --service-arn) and `aws`+`jq` on PATH. NEVER implied by anything else.
  --service-arn <arn>         App Runner service ARN. Falls back to $TIMS_APPRUNNER_SERVICE_ARN.
  --skip-verify-confirm-i-know-what-im-doing
                              Escape hatch: allows --flip-backend without a --verify-only pass in
                              the same invocation. Use only when you already verified separately.
  --list                      Print every known surface, its flag, parity key, FE flag, and status.
  --help                      Print this message.

EXAMPLES
  scripts/deploy/cutover.sh dei --verify-only
  scripts/deploy/cutover.sh dei --verify-only --flip-backend --yes
  scripts/deploy/cutover.sh access-review-write --flip-backend --skip-verify-confirm-i-know-what-im-doing
  scripts/deploy/cutover.sh dei --rollback --yes
  scripts/deploy/cutover.sh --list
  # NOTE: "reporting", "evaluation360" (read), "team-intel", "billing-usage", and "audit-log" no
  # longer have a real --verify-only check — their TS procedures were deleted (2026-07-28 for the
  # first two, 2026-07-29 for the next two, 2026-07-31 for audit-log), so there's nothing left to
  # diff against. --verify-only for any of these five still runs (prints a no-op notice and exits
  # 0) rather than erroring.

See scripts/deploy/README-cutover.md for the full worked flow.
EOF
}

print_list() {
  printf '%-20s %-6s %-36s %-28s %-44s %-14s\n' "SURFACE" "KIND" "BACKEND FLAG" "PARITY VERIFY" "FE FLAG" "STATUS"
  printf '%s\n' "-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------"
  for s in $ALL_SURFACES; do
    row="$(surface_row "$s")"
    kind="$(field "$row" 1)"
    flag="$(field "$row" 2)"
    pcmd="$(field "$row" 3)"
    pkey="$(field "$row" 4)"
    fe="$(field "$row" 5)"
    status="$(field "$row" 6)"
    printf '%-20s %-6s %-36s %-28s %-44s %-14s\n' \
      "$s" "$kind" "Platform:${flag}" "${pcmd} ${pkey}" "$fe" "$(status_label "$status")"
  done
  echo
  echo "Notes column (full detail, one per surface):"
  for s in $ALL_SURFACES; do
    row="$(surface_row "$s")"
    note="$(field "$row" 7)"
    echo
    echo "  ${s}:"
    echo "    ${note}"
  done
}

# ---------------------------------------------------------------------------------------------
# --verify-only: shells out to the real parity CLI. Read surfaces use `verify <key>`; write
# surfaces use `verify-write <key>` (scripts/parity/cli.ts dispatch — see cli.ts:296-311). This
# is the ONLY mode that talks to a live C#/Supabase endpoint, and it is entirely non-mutating.
# ---------------------------------------------------------------------------------------------
run_verify() {
  local surface="$1" row kind pcmd pkey
  row="$(surface_row "$surface")"
  kind="$(field "$row" 1)"
  pcmd="$(field "$row" 3)"
  pkey="$(field "$row" 4)"

  echo "==> verify-only: ${surface} (kind=${kind})"
  if [ "$pcmd" = "NONE" ]; then
    echo "    No parity command registered for \"${surface}\" — its TS router was deleted outright,"
    echo "    so there is no TS side left to diff against (see --list for detail). Treating this as"
    echo "    trivially passed: nothing to verify."
    return 0
  fi
  echo "    npx tsx ${PARITY_CLI} ${pcmd} ${pkey}"
  (
    cd "$REPO_ROOT"
    npx tsx "$PARITY_CLI" "$pcmd" "$pkey"
  )
}

# ---------------------------------------------------------------------------------------------
# --flip-backend / --rollback: the App Runner env-var flip.
#
# WHY `aws apprunner update-service` over Terraform, for the general case: the Terraform module
# (services/Tims.Platform/deploy/terraform/variables.tf `feature_flags` object) only models 9 of
# the ~24 Platform:<Surface>Enabled flags — external_vendor_read/write, billing_read,
# billing_usage, billing_webhook_write, billing_self_serve, reporting_read, validation_staff_write,
# team_intel_read. It has NO field at all for evaluation360/succession/compensation/nine-box/
# engagement/dei/audit-log/access-review (read OR write) — 8 of our 12 read surfaces and all 6 of
# our write surfaces would need the module extended (new optional fields in variables.tf + wiring
# in main.tf's local.base_env) before `terraform apply -target=aws_apprunner_service.api` could
# touch them at all. Rather than have this script special-case "4 surfaces via Terraform, 8+6 via
# AWS CLI" (exactly the kind of inconsistency the task asks to avoid), it always uses the direct
# `aws apprunner update-service` path — the one mechanism that works uniformly for every surface
# today. The known tradeoff: flipping via the AWS CLI drifts Terraform state (a future `terraform
# apply` using the old `terraform.tfvars` would try to revert the flag) — call out to Federico:
# either mirror the flip into terraform.tfvars afterwards, or extend the module to close this gap.
#
# AWS App Runner's UpdateService REPLACES the entire RuntimeEnvironmentVariables map — it does
# NOT merge. So flipping exactly one flag requires describe-service first, merge with jq, then
# update-service with the full merged map — never a partial/single-var update. That describe ->
# merge -> update sequence is exactly what this function prints/runs.
#
# SILENT-FAILURE GUARDS (do not remove): a single describe-service call (not two — two separate
# calls raced against each other, and a config change landing between them would have been
# merged onto stale data) feeds every downstream step. `aws ... --query` returns exit 0 with
# literal `null` on stdout when the JMESPath doesn't resolve (wrong shape, service not sourced
# from ImageRepository, API contract drift) — jq happily accepts `null` as an empty object and
# proceeds, so an unguarded merge would silently build a RuntimeEnvironmentVariables map
# containing ONLY the one flag being flipped. `update-service` then REPLACES the real map with
# that, deleting every other flag/secret env var on the live service. Each step below is
# guarded (`if ! VAR=$(...)`) so a describe-service failure, a null/missing path, or a merge
# that would shrink the env-var count aborts loudly BEFORE update-service is ever called.
# ---------------------------------------------------------------------------------------------
flip_command_block() {
  local surface="$1" target_value="$2" flag service_arn safe_service_arn row
  row="$(surface_row "$surface")"
  flag="$(field "$row" 2)"
  service_arn="${SERVICE_ARN:-<APPRUNNER_SERVICE_ARN>}"
  # SECURITY: service_arn comes from --service-arn / $TIMS_APPRUNNER_SERVICE_ARN, both
  # user-controlled. This whole block is later `eval`'d verbatim in do_flip_backend/
  # do_rollback when --yes is passed, so naively interpolating it into the heredoc below
  # (the old `SERVICE_ARN="${service_arn}"`) let a value like
  # `x"; rm -rf ~; echo "` break out of the quotes and execute arbitrary shell commands —
  # confirmed by reproduction (a crafted --service-arn wrote a marker file via `touch`
  # when run through this function). `printf %q` shell-escapes the value into a single
  # safely-quoted token that reconstructs to the exact original string on eval, with no
  # possibility of breaking out into command context.
  safe_service_arn="$(printf '%q' "$service_arn")"

  cat <<EOF
# --- App Runner flag flip: Platform:${flag} -> ${target_value} -------------------------------
SERVICE_ARN=${safe_service_arn}
if ! SRC_CONFIG=\$(aws apprunner describe-service --service-arn "\$SERVICE_ARN" \\
  --query 'Service.SourceConfiguration' --output json); then
  echo "ERROR: aws apprunner describe-service failed for \$SERVICE_ARN. Refusing to proceed." >&2
  exit 1
fi
if [ -z "\$SRC_CONFIG" ] || [ "\$SRC_CONFIG" = "null" ]; then
  echo "ERROR: aws apprunner describe-service returned empty/null SourceConfiguration for \$SERVICE_ARN. Refusing to proceed (would build a broken update-service payload)." >&2
  exit 1
fi
if ! CURRENT_ENV=\$(echo "\$SRC_CONFIG" | jq -e '.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables'); then
  echo "ERROR: .ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables is null/missing in the describe-service response (unexpected service shape — is this actually an ImageRepository-sourced service?). Refusing to proceed." >&2
  exit 1
fi
if ! CURRENT_COUNT=\$(echo "\$CURRENT_ENV" | jq 'keys | length'); then
  echo "ERROR: could not enumerate keys of the current RuntimeEnvironmentVariables map (unexpected type — not a JSON object?). Refusing to proceed." >&2
  exit 1
fi
if ! NEW_ENV=\$(echo "\$CURRENT_ENV" | jq --arg v "${target_value}" '.["Platform__${flag}"] = \$v'); then
  echo "ERROR: jq failed to merge Platform__${flag}=${target_value} into the current env-var map. Refusing to proceed." >&2
  exit 1
fi
NEW_COUNT=\$(echo "\$NEW_ENV" | jq 'keys | length')
if [ "\$NEW_COUNT" -lt "\$CURRENT_COUNT" ]; then
  echo "ERROR: merged env-var map has FEWER keys (\$NEW_COUNT) than the current one (\$CURRENT_COUNT) — refusing to call update-service (this would silently drop existing env vars/flags on the real service)." >&2
  exit 1
fi
FLIPPED_VALUE=\$(echo "\$NEW_ENV" | jq -r '.["Platform__${flag}"]')
if [ "\$FLIPPED_VALUE" != "${target_value}" ]; then
  echo "ERROR: sanity check failed — Platform__${flag} reads \\"\$FLIPPED_VALUE\\" in the merged map, expected \\"${target_value}\\". Refusing to proceed." >&2
  exit 1
fi
if ! NEW_SRC=\$(echo "\$SRC_CONFIG" | jq --argjson env "\$NEW_ENV" '.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables = \$env'); then
  echo "ERROR: jq failed to build the final SourceConfiguration payload. Refusing to proceed." >&2
  exit 1
fi
aws apprunner update-service --service-arn "\$SERVICE_ARN" --source-configuration "\$NEW_SRC"
EOF

  case "$surface" in
    team-intel|reporting|billing-read|billing-usage)
      cat <<EOF

# --- Terraform alternative (this surface IS modeled in variables.tf feature_flags) ------------
# In services/Tims.Platform/deploy/terraform/terraform.tfvars, set the matching feature_flags key
# to ${target_value}, then:
#   cd services/Tims.Platform/deploy/terraform
#   terraform apply -target=aws_apprunner_service.api
# (A full \`terraform apply\` is safer than -target long-term, but -target keeps the blast radius
# to just this one resource for a single-flag canary flip.)
EOF
      ;;
    *)
      cat <<EOF

# NOTE: "${surface}" (Platform:${flag}) has NO corresponding field in
# services/Tims.Platform/deploy/terraform/variables.tf's feature_flags object today, so there is
# no Terraform-only path for this surface yet — the AWS CLI recipe above is the only option until
# the module is extended.
EOF
      ;;
  esac
}

do_flip_backend() {
  local surface="$1"
  echo "==> flip-backend: ${surface} -> true"
  local cmd
  cmd="$(flip_command_block "$surface" "true")"
  if [ "$EXECUTE" = "1" ]; then
    require_aws_tools
    echo "$cmd"
    echo "--- EXECUTING (--yes was passed) ---"
    eval "$cmd"
  else
    echo "[dry-run — pass --yes to execute]"
    echo "$cmd"
  fi
}

do_rollback() {
  local surface="$1" row fe status
  row="$(surface_row "$surface")"
  fe="$(field "$row" 5)"
  status="$(field "$row" 6)"
  echo "==> rollback: ${surface} -> false"
  local cmd
  cmd="$(flip_command_block "$surface" "false")"
  if [ "$EXECUTE" = "1" ]; then
    require_aws_tools
    echo "$cmd"
    echo "--- EXECUTING (--yes was passed) ---"
    eval "$cmd"
  else
    echo "[dry-run — pass --yes to execute]"
    echo "$cmd"
  fi
  echo
  if [ "$status" = "TS_DELETED" ]; then
    echo "--- FE rollback is NOT available for this surface ---"
    echo "This surface's TS fallback code has been deleted (status: TS_DELETED). Setting"
    echo "${fe}=false would NOT restore old behavior — there is no tRPC path left to fall back to."
    echo "The only real rollback path is reverting the code (git revert the TS-deletion commit(s))"
    echo "and redeploying apps/web, in addition to the backend flag flip above."
  elif [ "$fe" = "NONE" ]; then
    echo "--- ALSO revert the FE flag (fastest path — do this immediately after the backend flip) ---"
    echo "No NEXT_PUBLIC_*_VIA_CSHARP flag is wired for this surface in apps/web today — nothing to revert on the FE side."
  else
    echo "--- ALSO revert the FE flag (fastest path — do this immediately after the backend flip) ---"
    cat <<EOF
1. Vercel dashboard -> tims-ats project -> Settings -> Environment Variables -> Production.
2. Set ${fe}=false (or delete it — the code in apps/web/lib/platform-api/*.ts treats anything
   other than the literal string "true" as false).
3. Redeploy the Production deployment (Vercel -> Deployments -> ... -> Redeploy) so the new env
   value takes effect — env var changes alone do NOT hot-reload a running Next.js deployment.
4. Confirm in the browser (or \`curl\`) that the surface's requests go back to /api/trpc/... and
   not the platform-api base URL.
EOF
  fi
}

require_aws_tools() {
  command -v aws >/dev/null 2>&1 || { echo "ERROR: aws CLI not found on PATH." >&2; exit 1; }
  command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found on PATH." >&2; exit 1; }
  if [ -z "${SERVICE_ARN:-}" ]; then
    echo "ERROR: --yes requires a service ARN. Pass --service-arn <arn> or set TIMS_APPRUNNER_SERVICE_ARN." >&2
    exit 1
  fi
}

# ---------------------------------------------------------------------------------------------
# Argument parsing (bash 3.2-compatible — no associative arrays, no ${var,,}).
# ---------------------------------------------------------------------------------------------
SURFACE=""
MODE_VERIFY=0
MODE_FLIP=0
MODE_ROLLBACK=0
MODE_LIST=0
EXECUTE=0
SKIP_VERIFY_CONFIRM=0
SERVICE_ARN="${TIMS_APPRUNNER_SERVICE_ARN:-}"

while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE_LIST=1 ;;
    --help|-h) usage; exit 0 ;;
    --verify-only) MODE_VERIFY=1 ;;
    --flip-backend) MODE_FLIP=1 ;;
    --rollback) MODE_ROLLBACK=1 ;;
    --yes) EXECUTE=1 ;;
    --skip-verify-confirm-i-know-what-im-doing) SKIP_VERIFY_CONFIRM=1 ;;
    --service-arn)
      shift
      [ $# -gt 0 ] || { echo "ERROR: --service-arn requires a value." >&2; exit 1; }
      case "$1" in
        --*) echo "ERROR: --service-arn requires a value, got option-looking argument \"$1\" (did you forget the ARN?)." >&2; exit 1 ;;
      esac
      SERVICE_ARN="$1"
      ;;
    --service-arn=*)
      SERVICE_ARN="${1#--service-arn=}"
      ;;
    --*)
      echo "ERROR: unknown option \"$1\"." >&2
      usage >&2
      exit 1
      ;;
    *)
      if [ -n "$SURFACE" ]; then
        echo "ERROR: unexpected extra argument \"$1\" (surface already set to \"$SURFACE\")." >&2
        exit 1
      fi
      SURFACE="$1"
      ;;
  esac
  shift
done

if [ "$MODE_LIST" = "1" ]; then
  print_list
  exit 0
fi

if [ -z "$SURFACE" ]; then
  echo "ERROR: missing <surface> argument." >&2
  usage >&2
  exit 1
fi

if ! surface_row "$SURFACE" >/dev/null 2>&1; then
  echo "ERROR: unknown surface \"$SURFACE\". Known surfaces:" >&2
  echo "  $ALL_SURFACES" >&2
  echo "Run --list for full detail." >&2
  exit 1
fi

if [ "$MODE_FLIP" = "1" ] && [ "$MODE_ROLLBACK" = "1" ]; then
  echo "ERROR: --flip-backend and --rollback are mutually exclusive." >&2
  exit 1
fi

# Default mode: --verify-only, exactly as documented (spec #1: "this alone is genuinely runnable
# today ... no flag mutation involved").
if [ "$MODE_VERIFY" = "0" ] && [ "$MODE_FLIP" = "0" ] && [ "$MODE_ROLLBACK" = "0" ]; then
  MODE_VERIFY=1
fi

# --- Sequencing safety gate (spec #4) ----------------------------------------------------------
# Refuse --flip-backend unless verify ran (and passed) in this SAME invocation, or the explicit
# escape hatch was passed. --rollback is intentionally EXEMPT — see --rollback's own docs above.
VERIFY_EXIT_CODE=""
if [ "$MODE_VERIFY" = "1" ]; then
  set +e
  run_verify "$SURFACE"
  VERIFY_EXIT_CODE=$?
  set -e
  echo
  if [ "$VERIFY_EXIT_CODE" != "0" ]; then
    echo "!! verify-only FAILED (exit ${VERIFY_EXIT_CODE}) for \"${SURFACE}\"."
  else
    echo "verify-only PASSED for \"${SURFACE}\"."
  fi
fi

if [ "$MODE_FLIP" = "1" ]; then
  if [ "$MODE_VERIFY" = "1" ]; then
    if [ "$VERIFY_EXIT_CODE" != "0" ]; then
      echo "ERROR: refusing --flip-backend — the --verify-only run in this same invocation FAILED. Fix the parity gap first, or re-run with --skip-verify-confirm-i-know-what-im-doing if you are certain this is safe to flip anyway." >&2
      exit 1
    fi
  elif [ "$SKIP_VERIFY_CONFIRM" != "1" ]; then
    echo "ERROR: refusing --flip-backend for \"${SURFACE}\" without verifying first." >&2
    echo "Either: (a) run with --verify-only --flip-backend together in one invocation, or" >&2
    echo "        (b) pass --skip-verify-confirm-i-know-what-im-doing if you already verified separately." >&2
    exit 1
  fi
  echo
  do_flip_backend "$SURFACE"
fi

if [ "$MODE_ROLLBACK" = "1" ]; then
  echo
  do_rollback "$SURFACE"
fi

# Exit code contract: a bare `--verify-only` (the default mode) must propagate the parity CLI's
# own pass/fail so this script is usable as a CI/scripting gate, e.g.
# `./cutover.sh engagement --verify-only && ./cutover.sh engagement --flip-backend --yes`
# (for "reporting"/"evaluation360" read/"team-intel"/"billing-usage", whose TS routers are
# deleted, run_verify's NONE branch above returns 0 unconditionally instead of a real pass/fail). Once a
# mutating mode (--flip-backend/--rollback) also ran, THEIR success is what the exit code reports
# (they already refuse to run on a verify failure, so reaching this point means they printed/ran
# fine even if the earlier bundled verify had failed and was overridden via the escape hatch).
if [ "$MODE_FLIP" = "0" ] && [ "$MODE_ROLLBACK" = "0" ] && [ -n "$VERIFY_EXIT_CODE" ]; then
  exit "$VERIFY_EXIT_CODE"
fi
