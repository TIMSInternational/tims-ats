# Tier-1 Last-Mile UI Wiring — Design

> Date: 2026-06-29 · Status: approved (design) · Branch: `feat/tier1-last-mile-wiring`
> Source: `docs/REMAINING-WORK.md` Tier 1. Backlog audit (2026-06-29) found a systemic pattern —
> real backend mutations exist, but the primary UI action buttons are `toast('próximamente')` stubs.

## Overview

Surface existing-but-unwired backend mutations through working UI controls across 6 modules,
replacing `toast('próximamente')`/disabled stubs with real create/action flows. **No new backend**
(the mutations already exist and are scope/permission-guarded server-side); this is pure
frontend wiring following the repo's established form pattern.

## Locked decisions (from brainstorm 2026-06-29)
1. **One shared pattern, applied 6×** — not bespoke UX per module, not a new abstraction (the repo
   already has the primitives: `Modal`, `react-hook-form`+Zod, `lib/toast`, tRPC `utils.invalidate`).
2. **6 independent, individually-shippable slices**, ordered by value:
   Succession → Engagement → Compensation → Performance → Learning → Onboarding.
3. **Out of scope (deferred to their proper tiers):** all "Export" buttons (need the CSV/XLSX export
   infra — Tier 4) and any "Simulate" that is a backend stub (Tier 2). This effort is purely
   "wire a REAL existing mutation to working UI." If an "existing" mutation turns out to be a stub
   during planning, it drops from scope.

## The shared pattern (every action)

```
[stub button]  →  shared focus-trapped <Modal>  →  react-hook-form + Zod form
   →  EXISTING trpc.<module>.<mutation>.useMutation({
        onSuccess: () => { toast(t.<ns>.<successKey>); utils.<module>.<query>.invalidate(); close(); },
        onError:   () => toast(t.<ns>.<errorKey>, { type: 'error' }),
      })
```

- **UI primitives:** the shared `Modal` (focus trap) from `apps/web/components`, `react-hook-form` +
  Zod resolver for the form (no per-field `useState`), `toast()` from `lib/toast.ts`.
- **Cache:** invalidate the list/dashboard query the action affects via `trpc.useUtils()`.
- **i18n:** every label/placeholder/toast via `t.*`, added to BOTH `es.json` + `en.json` (the i18n
  gate `tests/security/i18n-no-hardcoded-strings.test.ts` enforces this — see [[tims-i18n-enforcement]]).
- **No backend changes** beyond, at most, aligning a Zod input bound if the form needs it; the
  mutations + their permission/scope gates already exist (Wave 2.5).
- **Access:** the action button visibility may follow the existing `useCan()`/permission UI gate where
  a module already uses it; the server mutation is the real boundary regardless.

## Per-slice inventory

Mutation names below are the EXPECTED targets; the plan confirms exact names + input shapes via
exploration, and any that prove to be stubs drop out.

### Slice 1 — Succession: Add Successor
- Button: `talent/succession` "Agregar Sucesor" (currently `toast('próximamente')`).
- Form: target critical role (select from existing roles) + candidate employee (UserPicker) +
  readiness level (enum). Mutation: `succession.addSuccessor`.
- Invalidate: the succession dashboard/list query.

### Slice 2 — Engagement: Launch Survey
- Button: `engagement/climate` "Launch Survey" (currently toast).
- Form: title + survey type (enum) + template/question source + target audience (org/unit). Mutation:
  the survey-create procedure (`engagement.createSurvey` or equiv). Survey-TAKING already works
  (employee dashboard) — only the create/launch is wired here.
- Invalidate: the surveys list.

### Slice 3 — Compensation: Approve Adjustment
- Button: `compensation` approve action (currently unwired). Mutation: `compensation.approveAdjustment`
  (already atomic + conditional server-side). Confirmation modal (not a big form) + reason field if the
  input requires it.
- Invalidate: the adjustments list + any KPI query the approval moves.

### Slice 4 — Performance: Create OKR · Create Commitment · Log Coaching Session
- Buttons: `people/performance` "Nueva evaluación"/create stubs. Three small forms (one modal each, or
  a shared modal with a type switch — plan decides):
  - Create OKR (`performance.createOkr`): objective + key results + owner + period.
  - Create Commitment (`performance.createCommitment`): description + owner + due.
  - Log Coaching Session (`performance.createCoachingSession` / `logCoachingSession`): employee + coach +
    date + notes.
- Invalidate: the respective performance lists.

### Slice 5 — Learning: Enroll · Complete
- Buttons: `learning` enroll/complete (backend exists, UI read-only).
  - Enroll (`learning.enroll`): course/path + employee(s).
  - Complete (`learning.completeEnrollment`): mark an enrollment complete.
- Invalidate: the catalog/enrollment + progress queries. NOTE: the fabricated `Math.random()` progress
  (`course-catalog.tsx:110`) is a Tier-2 fix, NOT in this slice — but flag it so it isn't mistaken for
  real once enroll/complete are wired.

### Slice 6 — Onboarding: Toggle Task · Create Plan
- Buttons: `people/onboarding` task-toggle (mark done) + "Crear" plan (currently toast).
  - Toggle task (`onboarding.toggleTask` / `setTaskDone`): inline checkbox → mutation (no modal needed).
  - Create plan (`onboarding.createPlan`): employee + template/start date.
- Invalidate: the onboarding plans/KPIs.

## Out of scope (explicit)
- All "Export" buttons (Succession, Onboarding, Performance, Compensation, Monitoring, DEI) → Tier 4
  (CSV/XLSX export infra does not exist).
- "Simulate"/"Simulador" actions that are backend stubs (nine-box Simulador `_stub`, succession
  `simulateExit` is real but read-only — not an action to wire) → Tier 2/sim.
- Fabricated read-only data fixes (Learning `Math.random`, Performance OKR on-target/at-risk split,
  Team-Intelligence `DEMO_*`) → Tier 2.

## Testing
- **Static-source tripwires** (repo convention) per slice: the button renders the modal/calls the
  mutation (not `toast('próximamente')`), the modal/form is present, both-locale i18n keys exist, no
  inline styles, no `any`.
- **Behavioral units** for any pure form logic (Zod schema edge cases) where non-trivial.
- **Gate per slice:** `@tims/api` tsc + web tsc + full vitest (incl. the i18n gate) green.
- No new backend tests needed (mutations + their access tests already exist from Wave 2.5).

## Risks / open items resolved in the plan
1. **Exact mutation names + input shapes** — confirmed via exploration at plan time; a stub-in-disguise
   drops to its tier.
2. **Permission/visibility** — reuse the module's existing `useCan()` gate if present; server mutation
   is the boundary.
3. **Form complexity variance** — Compensation approve is a confirm dialog; Performance/Succession are
   real forms. The plan sizes each slice's tasks accordingly.

## Deploy
Frontend-only, no migration/env. Per repo norm: feat branch → PR → admin-merge past the CI billing trap
(local gate green) → Vercel auto-deploy. Each slice is independently mergeable.
