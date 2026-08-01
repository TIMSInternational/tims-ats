#!/bin/bash
# Interactive checklist for the last AI-doable-adjacent blocker in the C# migration:
# external-vendor write. (Compensation FX-read — item 1 below — is CLOSED as of
# 2026-07-31: fx_rates was seeded, NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP is
# confirmed permanently live in prod, and the TS side
# (getBandDistribution/getTotalCompBreakdown/getDashboardKpis) has been deleted —
# see docs/REMAINING-WORK.md's Compensation entry.) External-vendor write is gated on
# Federico doing a real prod action himself (creating+testing a scoped API key) — this
# script NEVER asks you to paste secrets, keys, or connection strings into it, and it
# never sends anything to Claude. It just walks you through the existing runbook and
# records a local, secret-free progress file so you can resume later.
#
# What this script does NOT do: touch prod, run migrations, seed data, create API
# keys, or flip any flag. Every actual prod-mutating command is printed for you to
# run yourself in your own terminal, per the "Claude never touches prod directly"
# rule already documented in fx-seed-once-runbook.md.
#
# Billing/Stripe is deliberately NOT in this checklist — that cutover was already
# explicitly declined. Phase 6 (Team Suite) is deliberately NOT in this checklist —
# it needs a scoping conversation first, not a script step.
set -euo pipefail

PROGRESS_FILE="scripts/deploy/.migration-checklist-progress"
touch "$PROGRESS_FILE"

is_done() { grep -qx "$1" "$PROGRESS_FILE" 2>/dev/null; }
mark_done() { grep -qx "$1" "$PROGRESS_FILE" 2>/dev/null || echo "$1" >> "$PROGRESS_FILE"; }

confirm() {
  local prompt="$1" answer=""
  while true; do
    read -rp "$prompt (y/n): " answer
    case "$answer" in
      [Yy]*) return 0 ;;
      [Nn]*) return 1 ;;
      *) echo "  Please answer y or n." ;;
    esac
  done
}

section() {
  echo ""
  echo "================================================================"
  echo "$1"
  echo "================================================================"
}

echo "This checklist covers the 1 remaining migration item that is actually"
echo "unblockable right now (item 1 below is already closed, kept only for a"
echo "complete picture). It never asks for secrets — only yes/no confirmations"
echo "of steps YOU run yourself, following the linked runbook."
echo ""
echo "Progress is saved to $PROGRESS_FILE — re-run this script anytime to resume."

# ---------------------------------------------------------------------------
# 1. Compensation FX-read — CLOSED 2026-07-31, kept only so is_done() below still
#    reports the full picture accurately for anyone re-running this script.
# ---------------------------------------------------------------------------
section "1/2 — Compensation FX-read (NEXT_PUBLIC_COMPENSATION_FX_READ_VIA_CSHARP) — DONE"

if is_done "fx-seed-complete"; then
  echo "Already marked complete in a prior run."
else
  # Auto-record: fx_rates was seeded, the flag confirmed permanently live in prod
  # (parity-verified 10/10 PASS), and the TS side was deleted in the same pass —
  # nothing left for this script to ask about.
  mark_done "fx-seed-complete"
  echo "Recorded as complete (fx_rates seeded, flag live, TS side deleted — 2026-07-31)."
fi

# ---------------------------------------------------------------------------
# 2. External-vendor write
# ---------------------------------------------------------------------------
section "2/2 — External-vendor write (NEXT_PUBLIC_EXTERNAL_VENDOR_WRITE_VIA_CSHARP)"

if is_done "external-vendor-write-complete"; then
  echo "Already marked complete in a prior run. Skipping."
else
  echo "Full runbook: docs/architecture/csharp-migration/external-vendor-write-reverify-runbook.md"
  echo ""
  echo "Summary of what YOU need to do:"
  echo "  1. Settings -> Integrations -> API Keys -> Create (environment: production,"
  echo "     scope: validation:write). Copy the key — shown once."
  echo "  2. Send one real test submitValidationResult request against the current (TS) path"
  echo "     (curl example in the runbook)"
  echo "  3. Confirm the C# side behaves identically (parity harness or a direct call)"
  echo ""
  if confirm "Have you completed all 3 steps and both sides behaved identically?"; then
    mark_done "external-vendor-write-complete"
    echo ""
    echo "Recorded. Next time you talk to Claude, just say \"external-vendor write re-verified,"
    echo "both sides matched\" — Claude flips the Vercel flag and does the TS-deletion. No key"
    echo "value needed for that part, ever paste it anywhere."
  else
    echo "No problem — re-run this script once you've done it."
  fi
fi

# ---------------------------------------------------------------------------
# Explicitly out of scope
# ---------------------------------------------------------------------------
section "Explicitly NOT in this checklist"
echo "- Billing/Stripe write cutover — already declined, not re-litigated here."
echo "- Phase 6 (Team Suite integration) — needs a scoping conversation about the"
echo "  tims.configuration.core intake study, not a script step. Bring it up with Claude"
echo "  directly when you're ready to scope it."

echo ""
if is_done "fx-seed-complete" && is_done "external-vendor-write-complete"; then
  echo "Both items complete. Every AI-doable-adjacent migration blocker is now cleared —"
  echo "only Billing/Stripe (declined) and Phase 6 (unscoped) remain, both Federico/product"
  echo "decisions, not engineering blockers."
else
  echo "Come back and re-run this script anytime — it picks up where you left off."
fi
