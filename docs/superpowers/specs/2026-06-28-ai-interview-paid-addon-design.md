# AI Voice Interview — Paid Add-on Toggle + Per-Type Duration Caps

> Date: 2026-06-28 · Status: approved (design) · Branch: `feat/ai-interview-paid-addon`
> Builds on: the AI voice interview feature + call redesign (specs 2026-06-24, 2026-06-26).

## Overview

Make the AI Voice Interview a **paid, platform-controlled per-org add-on**: a platform owner
turns it on for an org, which (a) unlocks the feature and (b) increases that org's billing
(a flat monthly add-on fee + usage on top). Also make the per-interview **duration cap**
configurable by interview type (default 15 min) so screens auto-end and cost stays bounded.

The toggle/budget plumbing partly exists: `AiAgentOrgConfig` (per org, per agent) already has
`enabled` + `monthlyBudget`, and `aiInterview.create`/`start` already read `monthlyBudget` and
check `isElevenLabsConfigured()`. This feature wires that into an explicit on/off gate, billing,
a platform admin UI, an org-side upsell, and the duration cap.

## Locked decisions (from brainstorm 2026-06-28)
1. **Billing model:** base monthly add-on fee **+ usage** (per billable minute) on top.
2. **Who toggles:** **platform owner only** (per contract/billing); org admins see an upsell, cannot self-activate.
3. **Duration cap:** **per interview-type override + org default (15 min)**; app-side auto-end.

## Architecture (source of truth)

`AiAgentOrgConfig` for the `ai-voice-interview` agent is the per-org control record. Extend it:
- `addonMonthlyFeeUsd Float?` — the flat unlock fee charged monthly while enabled.
- `billableUsdPerMinute Float?` — price charged to the org per interview minute (= EL cost + margin; distinct from the internal `VOICE_USD_PER_MINUTE` cost constant in the webhook).
- (existing) `enabled Boolean` — the on/off gate; (existing) `monthlyBudget Float?` — fail-closed spend cap.

**Feature-enabled rule (this agent only):** the AI Voice Interview is ON for an org iff an
`AiAgentOrgConfig` row exists for the `ai-voice-interview` agent with `enabled = true`. No row, or
`enabled = false` → OFF. (Do NOT change the generic default of `AiAgentOrgConfig.enabled` for other
agents; gate logic is specific to the ai-voice-interview agent path.)

Duration caps storage:
- Org default: `aiInterviewDefaultMaxMinutes` (default 15) — store on the `ai-voice-interview`
  `AiAgentOrgConfig` row (new column) OR an org-settings field; spec uses the AiAgentOrgConfig row.
- Per-type overrides: a small map `{ interviewType: maxMinutes }` stored as JSON on the same row
  (new column `aiInterviewMaxMinutesByType Json?`). At `create`, resolve cap = override[type] ?? default.

## Components / data flow

### A. On/off gate (backend)
- A shared helper `assertAiInterviewEnabled(orgId)` (service layer) that loads the `ai-voice-interview`
  `AiAgentOrgConfig` and throws `FORBIDDEN` ("AI Voice Interview is not enabled for this organization")
  when no row / `enabled=false`. Called at the TOP of `aiInterview.create` AND `aiInterview.start`
  (before the existing EL-configured + budget gates).
- Returns the config so callers reuse `billableUsdPerMinute`, `monthlyBudget`, and the cap fields
  without a second query.

### B. Duration cap (backend + call UI)
- `create` resolves `maxDurationSeconds = (overrideByType[interview.type] ?? defaultMaxMinutes ?? 15) * 60`
  and stores it on the new `AiInterviewSession.maxDurationSeconds Int?` column.
- `start` returns `maxDurationSeconds` alongside `signedUrl` / `dynamicVariables`.
- `useInterviewCall` exposes `maxDurationSeconds`; `CallShell`'s existing elapsed timer calls
  `call.end()` once elapsed ≥ maxDurationSeconds (with a brief "time's up" state). The EL agent's
  global 900s cap is the backstop. A pure helper `shouldAutoEnd(elapsedSeconds, maxDurationSeconds)`
  is unit-tested.

### C. Billing (backend)
- A pure `computeInterviewBillableUsd(durationSeconds, billableUsdPerMinute)` (rounding policy:
  round up to the nearest whole minute, or per-second — DECIDE in plan; default: per-second prorated,
  `ceil` to 2 decimals). Unit-tested.
- The post-call **webhook** already has `call_duration_secs`. Extend `processPostCallWebhook` to
  record a **billable usage entry** per interview using `billableUsdPerMinute` from the org's config
  (in addition to the existing internal voice-spend log). Persist via the existing usage/billing tables
  (TIMS is usage-based — reuse the same mechanism that records doc/AI usage; identify the exact table
  in the plan: `ai_invocations`/usage log or an invoice line).
- The flat `addonMonthlyFeeUsd` is surfaced to the existing invoicing path as a recurring add-on line
  while the feature is enabled (exact invoice wiring identified in the plan against `billing.prisma`).
- `monthlyBudget` remains the fail-closed CAP (already enforced in `start`).

### D. Platform control UI (platform owner only)
- Extend the existing **platform AI-agents admin** (`packages/api/src/routers/platform/ai-agents.ts`
  + its page) with a per-org control for the ai-voice-interview agent: toggle `enabled`, set
  `addonMonthlyFeeUsd`, `billableUsdPerMinute`, `monthlyBudget`, `aiInterviewDefaultMaxMinutes`, and
  the per-type overrides. Guarded by the existing platform-owner procedure.

### E. Org-side recruiter UX
- When OFF: the **"Iniciar entrevista IA"** action in `interview-table.tsx` is hidden (or shown
  disabled with an upsell tooltip/modal: "Available as an add-on — contact your account manager").
  Gate on a lightweight `aiInterview.isEnabled` query (reads the same config) so the UI doesn't call
  a budget-spending mutation to discover it's off.
- When ON: unchanged from today (the AiScreenModal flow).

## Non-goals (this round)
- Org-admin self-serve activation (platform-owner-only by decision 2).
- Stripe plan/price object changes — reuse the existing usage-based invoicing; no new Stripe SKUs unless the plan finds it necessary.
- Changing other agents' gating or the generic `AiAgentOrgConfig.enabled` default.
- Live transcript / call-UI redesign (done in the prior spec).

## Suggested implementation slices (for the plan)
- **Slice 1 — Gate + caps:** schema migration (config billing/cap columns + session.maxDurationSeconds),
  `assertAiInterviewEnabled`, cap resolver, `create`/`start` gate + cap, `isEnabled` query, recruiter
  UI hide/upsell, call-UI auto-end. (Makes the feature gated + cost-capped.)
- **Slice 2 — Billing + platform UI:** billable-amount calc, webhook usage recording, add-on fee
  invoicing, platform AI-agents admin controls. (Makes it monetized + controllable.)

## Testing
- Pure units: `shouldAutoEnd`, cap resolver (override vs default vs fallback 15), `computeInterviewBillableUsd`.
- Access tests: `create`/`start` throw FORBIDDEN when off; succeed when on; budget cap still enforced.
- Tripwires: recruiter table hides/ upsells when off; platform admin controls present; call-UI references the auto-end.
- Full gate green (tsc api+web, vitest, next build). Backend tenant-isolation preserved (org-scoped queries).

## Deploy notes
- Migration: `npx prisma db execute --file=<migration.sql>` against prod (prod not migrate-managed) +
  re-seed not required (no new agent). Frontend via Vercel git auto-deploy.
- The EL agent already has silence auto-hangup (30s) + 900s global cap set (2026-06-28).
