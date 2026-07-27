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
#                  (write surfaces, scripts/parity/write-surfaces.ts WRITE_SURFACES)
#   parity_key     the key registered in that file — NOT always identical to our surface name
#                  (see billing-read -> billing-invoices, nine-box -> ninebox below)
#   fe_flag        the NEXT_PUBLIC_*_VIA_CSHARP flag wired in apps/web/lib/platform-api/*.ts, or
#                  the literal string NONE when no such flag exists in the repo today
#   status         CONFIRMED_LIVE | FLIP_READY | COEXISTENCE | BLOCKED — see --list for the
#                  human-readable note attached to each
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
      echo "read|TeamIntelReadEnabled|verify|team-intel|NEXT_PUBLIC_TEAMINTEL_READ_VIA_CSHARP|CONFIRMED_LIVE|Flipped + confirmed live in prod 2026-07-27 (Federico) — runbook intro + §6 Phase A #1. Reference/proof case for this whole script."
      ;;
    reporting)
      echo "read|ReportingReadEnabled|verify|reporting|NEXT_PUBLIC_REPORTING_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #2."
      ;;
    billing-read)
      echo "read|BillingReadEnabled|verify|billing-invoices|NONE|FLIP_READY|Runbook §6 Phase A #3 (part 1). CAVEAT: no NEXT_PUBLIC_*_VIA_CSHARP wrapper found anywhere under apps/web/lib/platform-api/billing.ts (only BILLING_USAGE_VIA_CSHARP + BILLING_SELF_SERVE_WRITE_VIA_CSHARP exist there) — the FE-rewiring PR for invoice reads does not appear to have shipped despite the runbook's 'already done for all 12 domains' framing. Confirm with Federico before treating the FE half as cutover-ready; the backend flip below is unaffected either way."
      ;;
    billing-usage)
      echo "read|BillingUsageEnabled|verify|billing-usage|NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #3 (part 2)."
      ;;
    evaluation360)
      echo "read|Evaluation360ReadEnabled|verify|evaluation360|NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4."
      ;;
    succession)
      echo "read|SuccessionReadEnabled|verify|succession|NEXT_PUBLIC_SUCCESSION_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4."
      ;;
    compensation)
      echo "read|CompensationReadEnabled|verify|compensation|NEXT_PUBLIC_COMPENSATION_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4 — the FX-FREE subset only (7 of 12 comp reads). The 5 FX-dependent reads sit behind the separate FxReadsEnabled flag (needs the fx_rates migration + a seed first) and are intentionally NOT covered by this surface name."
      ;;
    nine-box)
      echo "read|NineBoxReadEnabled|verify|ninebox|NEXT_PUBLIC_NINEBOX_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4. NOTE: the parity harness registers this surface as \"ninebox\" (no hyphen) — this script accepts the friendlier \"nine-box\" and maps it internally."
      ;;
    engagement)
      echo "read|EngagementReadEnabled|verify|engagement|NEXT_PUBLIC_ENGAGEMENT_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4."
      ;;
    dei)
      echo "read|DeiReadEnabled|verify|dei|NEXT_PUBLIC_DEI_READ_VIA_CSHARP|FLIP_READY|Runbook §6 Phase A #4. getPayEquity (FX) is a separate Slice-11c surface, not covered here."
      ;;
    audit-log)
      echo "read|AuditLogReadEnabled|verify|audit-log|NEXT_PUBLIC_AUDIT_LOG_READ_VIA_CSHARP|FLIP_READY|Phase-5 Slice-17 — merged AFTER this runbook doc was last updated, so it is absent from the doc's own §6 Phase A/B lists. Classified FLIP-READY from PlatformOptions.cs + team memory (merged to main e0b70ed, dark; the service has never been redeployed with this code, so 'flip-ready' here means code-ready, not yet deploy-verified)."
      ;;
    access-review)
      echo "read|AccessReviewReadEnabled|verify|access-review|NEXT_PUBLIC_ACCESS_REVIEW_READ_VIA_CSHARP|FLIP_READY|Phase-5 Slice-18 — same situation as audit-log: post-dates the runbook's §6 lists. Read side is efcoreReadOnly over Phase-2 identity tables (users/roles/user_roles/role_permissions/permissions/organizations); access_reviews itself stays Prisma-owned until the WRITE flag (access-review-write) flips."
      ;;
    evaluation360-write)
      echo "write|Evaluation360WriteEnabled|verify-write|evaluation360|NEXT_PUBLIC_EVALUATION360_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #8 — FLIP-READY: once verified, drop the TS eval360 router + flip review_cycles/rater_assignments/rater_responses to efcore."
      ;;
    succession-write)
      echo "write|SuccessionWriteEnabled|verify-write|succession|NEXT_PUBLIC_SUCCESSION_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #9 — FLIP-READY: drop TS succession router, flip critical_roles/successors."
      ;;
    nine-box-write)
      echo "write|NineBoxWriteEnabled|verify-write|ninebox|NEXT_PUBLIC_NINEBOX_WRITE_VIA_CSHARP|FLIP_READY|Runbook §6 Phase B #10 — FLIP-READY: drop TS ninebox router, flip calibration_sessions/members/votes."
      ;;
    compensation-write)
      echo "write|CompensationWriteEnabled|verify-write|compensation|NEXT_PUBLIC_COMPENSATION_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #11 — COEXISTENCE: salary_adjustments/employee_compensations stay read by other surfaces; table stays efcoreStranglerWrite, no ownership flip."
      ;;
    engagement-write)
      echo "write|EngagementWriteEnabled|verify-write|engagement|NEXT_PUBLIC_ENGAGEMENT_WRITE_VIA_CSHARP|COEXISTENCE|Runbook §6 Phase B #12 — the flag flip itself is documented as canary-safe today (byte-identical rows both stacks), but COEXISTENCE for the terminal state: monitoring.ts/dei.ts/the alert cron still call Prisma models directly, so the TS router can't be deleted yet."
      ;;
    access-review-write)
      echo "write|AccessReviewWriteEnabled|verify-write|access-review|NEXT_PUBLIC_ACCESS_REVIEW_WRITE_VIA_CSHARP|FLIP_READY|Phase-5 Slice-18 write — post-dates the runbook's §6 lists (not classified there). PlatformOptions.cs docstring: this moves access_reviews to efcoreStranglerWrite in the table-ownership ledger. Tentatively FLIP-READY (nothing else writes access_reviews today) pending Federico's own review — this is the newest-merged surface in the whole catalog (PR #215, 2026-07-27)."
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
  scripts/deploy/cutover.sh reporting --verify-only
  scripts/deploy/cutover.sh reporting --verify-only --flip-backend --yes
  scripts/deploy/cutover.sh access-review-write --flip-backend --skip-verify-confirm-i-know-what-im-doing
  scripts/deploy/cutover.sh dei --rollback --yes
  scripts/deploy/cutover.sh --list

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
# ---------------------------------------------------------------------------------------------
flip_command_block() {
  local surface="$1" target_value="$2" flag service_arn row
  row="$(surface_row "$surface")"
  flag="$(field "$row" 2)"
  service_arn="${SERVICE_ARN:-<APPRUNNER_SERVICE_ARN>}"

  cat <<EOF
# --- App Runner flag flip: Platform:${flag} -> ${target_value} -------------------------------
SERVICE_ARN="${service_arn}"
CURRENT=\$(aws apprunner describe-service --service-arn "\$SERVICE_ARN" \\
  --query 'Service.SourceConfiguration.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables' \\
  --output json)
NEW_ENV=\$(echo "\$CURRENT" | jq --arg v "${target_value}" '.["Platform__${flag}"] = \$v')
NEW_SRC=\$(aws apprunner describe-service --service-arn "\$SERVICE_ARN" \\
  --query 'Service.SourceConfiguration' --output json \\
  | jq --argjson env "\$NEW_ENV" '.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables = \$env')
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
  local surface="$1" row fe
  row="$(surface_row "$surface")"
  fe="$(field "$row" 5)"
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
  echo "--- ALSO revert the FE flag (fastest path — do this immediately after the backend flip) ---"
  if [ "$fe" = "NONE" ]; then
    echo "No NEXT_PUBLIC_*_VIA_CSHARP flag is wired for this surface in apps/web today — nothing to revert on the FE side."
  else
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
# `./cutover.sh reporting --verify-only && ./cutover.sh reporting --flip-backend --yes`. Once a
# mutating mode (--flip-backend/--rollback) also ran, THEIR success is what the exit code reports
# (they already refuse to run on a verify failure, so reaching this point means they printed/ran
# fine even if the earlier bundled verify had failed and was overridden via the escape hatch).
if [ "$MODE_FLIP" = "0" ] && [ "$MODE_ROLLBACK" = "0" ] && [ -n "$VERIFY_EXIT_CODE" ]; then
  exit "$VERIFY_EXIT_CODE"
fi
