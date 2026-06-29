# Tier-1 Last-Mile UI Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `toast('próximamente')`/missing action controls in 6 modules with working create/action UI that calls the existing Wave-2.5 backend mutations.

**Architecture:** Each action = a `'use client'` component using the repo's established form pattern — raw `useState` per field + the shared focus-trapped `<Modal>` + `trpc.<router>.<mutation>.useMutation({ onSuccess → utils.<router>.<query>.invalidate() + toast(success) + onClose(); onError → toast(err.message) })`. Reference implementation: `apps/web/app/(admin)/people/performance/feedback-modal.tsx`. **One backend exception** (user-approved): a tiny `engagement.activateSurvey` mutation so S2's "Launch" genuinely activates a draft.

**Tech Stack:** Next.js 15 App Router, tRPC + react-query, Tailwind 4, TypeScript strict, Vitest. Backend: tRPC `permissionProcedure` + Prisma (`tenantDb`).

## Global Constraints

- **Form pattern = repo convention (user-decided 2026-06-29):** raw `useState` + native `<form>`/`onClick` submit + `trpc` mutation. **Do NOT introduce react-hook-form/Zod-resolver** — it has zero usages in the repo; match `feedback-modal.tsx`.
- **No `any`** — no `: any`, no `as any`. Use `lib/trpc-types.ts` inferred types or local interfaces.
- **No inline `style={{}}`** — Tailwind classes only (arbitrary hex in className like `text-[#333]` is the sibling convention and is allowed).
- **No hardcoded user-facing strings** — every multi-word/accented label, placeholder, `title=`/`aria-label=`, and `toast(...)` first-arg must be a `t.*` key. Keys added to **BOTH** `apps/web/lib/i18n/es.json` and `apps/web/lib/i18n/en.json` with identical key shape (the typed `t` derives from `es.json`). Enforced by `tests/security/i18n-no-hardcoded-strings.test.ts`.
- **Toast API:** `toast(message, { type: 'success' | 'error' | 'info' })` — options-object form, no `.error()` namespace. `onError: (err) => toast(err.message, { type: 'error' })`.
- **Imports (depth-4 admin pages):** `'use client'`; `{ trpc }` from `../../../../lib/trpc`; `{ useI18n }` from `../../../../lib/i18n`; `{ toast }` from `../../../../lib/toast`; `{ Modal }` / `{ UserPicker }` from `../../../../components`; `{ PickedUser }` type from `../../../../components/user-picker`.
- **Cache invalidation:** invalidate EVERY listed query (dashboard KPIs change on most writes). `utils.<router>.<query>.invalidate()`.
- **tenant/permission boundary is server-side** — the UI is not the security boundary. Use the module's existing `useCan()` gate for button visibility ONLY where the page already uses it; do not add new gating logic otherwise (server `permissionProcedure` already enforces).
- **Per-slice gate (must be green before commit):** `pnpm --filter @tims/api exec tsc --noEmit` + (in `apps/web`) `npx tsc --noEmit` + (repo root) `npx vitest run` (includes the i18n gate + the slice's tripwire test).
- **Each slice is an independent commit** and independently mergeable. Slice order: S1 → S2 → S3 → S4 → S5 → S6.

---

## Reference Implementation (instantiated by every slice)

### R1 — Canonical action-modal skeleton

This is the exact shape every modal in S1–S6 instantiates. Each task below specifies only the substitutions (state fields, mutation, input mapping, form JSX, i18n keys, invalidations).

```tsx
'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';

interface ActionModalProps {
  onClose: () => void;
  // + any preset entity props the slice needs (e.g. roles, courseId)
}

export function ActionModal({ onClose }: ActionModalProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  // 1. one useState per field (NO react-hook-form)
  const [field, setField] = useState('');

  // 2. existing mutation, wired with invalidate + toast + close
  const submit = trpc.MODULE.MUTATION.useMutation({
    onSuccess: () => {
      utils.MODULE.QUERY_A.invalidate();
      utils.MODULE.QUERY_B.invalidate();
      toast(t.NS.successKey, { type: 'success' });
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  // 3. client-side gate mirrors the server Zod required fields
  const canSubmit = field.trim().length > 0 && !submit.isPending;

  const onSubmit = () => {
    if (!canSubmit) return;
    submit.mutate({ /* map state → mutation input */ });
  };

  return (
    <Modal title={t.NS.titleKey} onClose={onClose}>
      <div className="space-y-4">
        {/* form fields — labels via t.*, classNames copied from feedback-modal.tsx */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submit.isPending}
            className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submit.isPending ? t.common.saving : t.common.save}
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

Field styling (copy verbatim from `feedback-modal.tsx`):
- Label: `className="block text-[12px] font-medium text-[#333] mb-1.5"`
- `<select>`/`<input>`/`<textarea>`: `className="w-full border border-[#EDEDED] rounded-lg px-3 py-2.5 text-[13px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"`
- Person picker: `<UserPicker onSelect={(_id, user) => setX(user)} disabled={submit.isPending} searchPlaceholder={t.committee.searchUser} loadingLabel={t.committee.loadingUsers} emptyLabel={t.committee.noUsers} />` (reuse existing `t.committee.*` keys).

### R2 — Trigger wiring (host page)

The host page is already `'use client'`. Add open/close state and conditionally mount the modal:

```tsx
const [showAction, setShowAction] = useState(false);
// button: onClick={() => setShowAction(true)}   (replace the toast(...comingSoon) call)
{showAction && <ActionModal onClose={() => setShowAction(false)} />}
```

### R3 — Tripwire test template (one per slice)

Static-source tripwires read the component file as raw text and assert the wiring exists. Place under `tests/tier1/`. Template:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, '../../', p), 'utf8');

describe('S? <module> wiring', () => {
  const modal = read('apps/web/<path>/<action>-modal.tsx');
  const host = read('apps/web/<path>/<host>.tsx');
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));

  it('calls the real mutation (not a comingSoon stub)', () => {
    expect(modal).toMatch(/trpc\.MODULE\.MUTATION\.useMutation/);
    expect(modal).not.toMatch(/comingSoon/);
  });
  it('invalidates the affected query', () => {
    expect(modal).toMatch(/utils\.MODULE\.QUERY_A\.invalidate/);
  });
  it('renders inside the shared Modal', () => {
    expect(modal).toMatch(/<Modal\b/);
    expect(modal).toMatch(/from '.*\/components'/);
  });
  it('host opens the modal instead of toasting comingSoon', () => {
    expect(host).toMatch(/<ActionModal\b/);
  });
  it('no inline style or any', () => {
    expect(modal).not.toMatch(/style=\{\{/);
    expect(modal).not.toMatch(/:\s*any\b/);
    expect(modal).not.toMatch(/\bas any\b/);
  });
  it('new i18n keys exist in BOTH locales', () => {
    for (const key of ['titleKey', 'successKey']) {
      expect(es.NS[key]).toBeTruthy();
      expect(en.NS[key]).toBeTruthy();
    }
  });
});
```

---

## Slice 1 — Succession: Add Successor

**Files:**
- Create: `apps/web/app/(admin)/talent/succession/add-successor-modal.tsx`
- Modify: `apps/web/app/(admin)/talent/succession/page.tsx` (button `:41`, add open state + mount modal; pass `roleItems`)
- Modify: `apps/web/lib/i18n/es.json` + `apps/web/lib/i18n/en.json` (namespace `succession`)
- Test: `tests/tier1/s1-succession-wiring.test.ts`

**Interfaces:**
- Consumes: `trpc.succession.listCriticalRoles` (already on page as `roleItems`: `{ id, title, criticality }[]`), `UserPicker` (`onSelect(userId, user: PickedUser)`).
- Mutation: `succession.addSuccessor` — input `{ criticalRoleId: string(uuid), userId: string(uuid), readiness: 'ready_now'|'ready_1_year'|'ready_2_years'|'developing', type: 'internal'|'external', developmentPlan?: string }`.
- Invalidate: `succession.listCriticalRoles`, `succession.getDashboardKpis`, `succession.getCompetencyCoverage`, `succession.getRolesWithoutSuccessor`.

- [ ] **Step 1 — Write the failing tripwire test** `tests/tier1/s1-succession-wiring.test.ts` (instantiate R3): assert `add-successor-modal.tsx` matches `trpc.succession.addSuccessor.useMutation`, `utils.succession.listCriticalRoles.invalidate`, `<Modal`; `page.tsx` matches `<AddSuccessorModal`; no `style={{`/`any`; keys `t.succession.addSuccessorTitle` + `.addSuccessorSuccess` present in both locales.

- [ ] **Step 2 — Run it, verify it fails** `npx vitest run tests/tier1/s1-succession-wiring.test.ts` → FAIL (file/keys missing).

- [ ] **Step 3 — Add i18n keys** to the `succession` namespace in BOTH `es.json` and `en.json`:
  - es: `addSuccessorTitle: "Agregar sucesor"`, `addSuccessorSuccess: "Sucesor agregado"`, `roleLabel: "Rol crítico"`, `candidateLabel: "Candidato"`, `readinessLabel: "Preparación"`, `successorTypeLabel: "Tipo"`, `developmentPlanLabel: "Plan de desarrollo"`, `readinessReadyNow: "Listo ahora"`, `readinessReady1: "Listo en 1 año"`, `readinessReady2: "Listo en 2 años"`, `readinessDeveloping: "En desarrollo"`, `typeInternal: "Interno"`, `typeExternal: "Externo"`, `selectRolePlaceholder: "Selecciona un rol"`.
  - en: same keys, English values (`"Add successor"`, `"Successor added"`, `"Critical role"`, `"Candidate"`, `"Readiness"`, `"Type"`, `"Development plan"`, `"Ready now"`, `"Ready in 1 year"`, `"Ready in 2 years"`, `"Developing"`, `"Internal"`, `"External"`, `"Select a role"`).

- [ ] **Step 4 — Create `add-successor-modal.tsx`** instantiating R1. Props: `{ roles: { id: string; title: string }[]; onClose: () => void }`. State: `roleId` (string, default ''), `candidate` (`PickedUser | null`), `readiness` (default `'ready_now'`), `type` (default `'internal'`), `developmentPlan` (string). Form: a `<select>` of `roles` (option value `r.id`, label `r.title`, plus a disabled placeholder `t.succession.selectRolePlaceholder`); `UserPicker` for candidate (show selected name w/ clear button like feedback-modal); two `<select>`s for readiness + type using the enum labels; a `<textarea maxLength={1000}>` for development plan. `canSubmit = !!roleId && !!candidate && !submit.isPending`. `submit.mutate({ criticalRoleId: roleId, userId: candidate.id, readiness, type, developmentPlan: developmentPlan.trim() || undefined })`. Use the readiness/type option arrays as `const`-typed tuples to keep the enums `as const` (no `any`).

- [ ] **Step 5 — Wire the trigger in `page.tsx`** — add `const [showAdd, setShowAdd] = useState(false)` (import `useState`); change button `:41` `onClick` from the toast to `() => setShowAdd(true)`; before the closing `</div>` of the page render `{showAdd && <AddSuccessorModal roles={roleItems} onClose={() => setShowAdd(false)} />}`; import the modal.

- [ ] **Step 6 — Run the tripwire test** → PASS.

- [ ] **Step 7 — Run the slice gate** `pnpm --filter @tims/api exec tsc --noEmit` && (`cd apps/web`) `npx tsc --noEmit` && (root) `npx vitest run` → all green.

- [ ] **Step 8 — Commit**
```bash
git add apps/web/app/\(admin\)/talent/succession/ apps/web/lib/i18n/ tests/tier1/s1-succession-wiring.test.ts
git commit -m "feat(succession): wire Add Successor modal to succession.addSuccessor"
```

---

## Slice 2 — Engagement: Create & Launch Survey

> **Scope note:** `engagement.createSurvey` creates a `status:'draft'` survey and `questions[]` is required (min 1). A new `engagement.activateSurvey` mutation (user-approved) flips draft→active so survey-taking works. The modal: collect fields → `createSurvey` → on success `activateSurvey({ id })` → on success toast + invalidate + close.

**Files:**
- Modify (backend): `packages/api/src/routers/engagement.ts` (add `activateSurvey`)
- Test (backend): `packages/api/test/engagement-activate-survey.test.ts` (or the repo's router-test location — match existing engagement tests)
- Create: `apps/web/app/(admin)/engagement/climate/launch-survey-modal.tsx`
- Modify: `apps/web/app/(admin)/engagement/climate/page.tsx` (button `:31`)
- Modify: `apps/web/lib/i18n/{es,en}.json` (namespace `climate`)
- Test: `tests/tier1/s2-engagement-wiring.test.ts`

**Interfaces:**
- `createSurvey` input: `{ title: string(1..200), type: 'pulse'|'enps'|'climate'|'custom', questions: { text: string(1..500), type: 'scale'|'text'|'multiple_choice'|'yes_no', required?: boolean, category?: string }[] (min 1), targetGroups?: {...}, startsAt?, endsAt? }`. Returns the created survey row incl. `id`.
- **Produces (new):** `activateSurvey` — input `{ id: string(uuid) }`; sets `status:'active'`, `startsAt = startsAt ?? now`; returns `{ id, status }`. Scope-guarded via `assertScoped('survey', id, ...)` (mirror the pattern in `getSurveyResults`/other engagement procedures).
- Invalidate: `engagement.listSurveys`, `engagement.getDashboardKpis`.

- [ ] **Step 1 — Write the failing backend test** `engagement-activate-survey.test.ts`: a draft survey for org A flips to `active` and gets a `startsAt`; calling `activateSurvey` on another org's survey id throws (NOT_FOUND/FORBIDDEN). Model the harness on the nearest existing engagement router test; if none exists, write a focused unit calling the procedure with a mocked `ctx` + `tenantDb`.

- [ ] **Step 2 — Run it, verify it fails** (`activateSurvey` undefined).

- [ ] **Step 3 — Add `activateSurvey`** to `engagementRouter` after `createSurvey`:
```ts
activateSurvey: permissionProcedure('engagement', 'create')
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    await assertScoped(ctx.access, 'survey', input.id);
    const existing = await db.survey.findFirst({
      where: { id: input.id, organizationId: ctx.user.organizationId },
      select: { id: true, startsAt: true },
    });
    if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
    return db.survey.update({
      where: { id: existing.id },
      data: { status: 'active', startsAt: existing.startsAt ?? new Date() },
      select: { id: true, status: true },
    });
  }),
```
(Confirm the exact `assertScoped` signature against its other call sites in this router; match it.)

- [ ] **Step 4 — Run the backend test** → PASS. Run `pnpm --filter @tims/api exec tsc --noEmit` → green.

- [ ] **Step 5 — Write the failing frontend tripwire** `tests/tier1/s2-engagement-wiring.test.ts` (R3): modal matches `trpc.engagement.createSurvey.useMutation` AND `engagement.activateSurvey`, `utils.engagement.listSurveys.invalidate`, `<Modal`, has an add-question control (`addQuestion`); `page.tsx` matches `<LaunchSurveyModal`; no `style={{`/`any`; keys `t.climate.launchSurveyTitle` + `.launchSurveySuccess` in both locales.

- [ ] **Step 6 — Run it, verify it fails.**

- [ ] **Step 7 — Add i18n keys** to `climate` namespace (BOTH locales): `launchSurveyTitle`, `launchSurveySuccess`, `surveyTitleLabel`, `surveyTypeLabel`, `typePulse`, `typeEnps`, `typeClimate`, `typeCustom`, `questionsLabel`, `addQuestion`, `removeQuestion`, `questionTextPlaceholder`, `questionTypeLabel`, `qtypeScale`, `qtypeText`, `qtypeMultipleChoice`, `qtypeYesNo`, `needOneQuestion`. (es + en values.)

- [ ] **Step 8 — Create `launch-survey-modal.tsx`** (R1, larger form). State: `title` (string), `type` (default `'climate'`), `questions` (`{ text: string; type: 'scale'|'text'|'multiple_choice'|'yes_no' }[]`, default one empty row). Pure helpers (export for unit test): `addQuestion(qs)`, `removeQuestion(qs, i)`, `updateQuestion(qs, i, patch)`. Render: title input; type select; a repeatable question list (text input + type select + remove button per row) + "Add question" button. `canSubmit = title.trim() && questions.length >= 1 && questions.every(q => q.text.trim()) && !create.isPending && !activate.isPending`. Two mutations:
```ts
const activate = trpc.engagement.activateSurvey.useMutation({
  onSuccess: () => { utils.engagement.listSurveys.invalidate(); utils.engagement.getDashboardKpis.invalidate(); toast(t.climate.launchSurveySuccess, { type: 'success' }); onClose(); },
  onError: (err) => toast(err.message, { type: 'error' }),
});
const create = trpc.engagement.createSurvey.useMutation({
  onSuccess: (survey) => activate.mutate({ id: survey.id }),
  onError: (err) => toast(err.message, { type: 'error' }),
});
const onSubmit = () => { if (!canSubmit) return; create.mutate({ title: title.trim(), type, questions: questions.map(q => ({ text: q.text.trim(), type: q.type, required: true })) }); };
```

- [ ] **Step 9 — (Behavioral unit) Test the question-builder helpers** `tests/tier1/s2-question-builder.test.ts`: `addQuestion` appends an empty row; `removeQuestion` removes by index but never drops below 1 row; `updateQuestion` patches the right index immutably. Run → fail → confirm helpers exported → pass.

- [ ] **Step 10 — Wire the trigger** in `climate/page.tsx`: `useState` open flag; button `:31` → `setShowLaunch(true)`; mount `{showLaunch && <LaunchSurveyModal onClose={() => setShowLaunch(false)} />}`.

- [ ] **Step 11 — Run all S2 tests + slice gate** → green.

- [ ] **Step 12 — Commit**
```bash
git commit -am "feat(engagement): wire Create+Launch Survey modal; add activateSurvey mutation"
```

---

## Slice 3 — Compensation: Approve / Reject Adjustment

> **Scope note:** No approve control exists — `PendingAdjustments` (`comp-right-column.tsx:97`) is a read-only table. Add a per-row action + a confirm modal. The mutation handles BOTH approve and reject via the `approved` boolean.

**Files:**
- Create: `apps/web/app/(admin)/compensation/approve-adjustment-modal.tsx`
- Modify: `apps/web/app/(admin)/compensation/comp-right-column.tsx` (`PendingAdjustments`, add per-row button + open state)
- Modify: `apps/web/lib/i18n/{es,en}.json` (namespace `compensation`)
- Test: `tests/tier1/s3-compensation-wiring.test.ts`

**Interfaces:**
- Consumes: rows from `trpc.compensation.listPendingAdjustments` (each has `id` + employee/type/change display fields — read the exact selected shape in the router/component and type the modal prop accordingly, NO `any`).
- Mutation: `compensation.approveAdjustment` — input `{ id: string(uuid), approved: boolean, comment?: string(<=500) }`. Returns `{ id, status }`.
- Invalidate: `compensation.listPendingAdjustments`, `compensation.getDashboardKpis`, `compensation.getBandDistribution`, `compensation.getCompaRatioDistribution`, `compensation.getTotalCompBreakdown`.

- [ ] **Step 1 — Write the failing tripwire** `tests/tier1/s3-compensation-wiring.test.ts` (R3): modal matches `trpc.compensation.approveAdjustment.useMutation`, `utils.compensation.listPendingAdjustments.invalidate`, `<Modal`, handles both verbs (`approved: true` and `approved: false`); `comp-right-column.tsx` matches `<ApproveAdjustmentModal`; no `style={{`/`any`; keys `t.compensation.approveTitle` + `.approveSuccess` + `.rejectSuccess` in both locales.

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Add i18n keys** to `compensation` (BOTH locales): `approveTitle`, `rejectTitle`, `approveSuccess` (`"Ajuste aprobado"`), `rejectSuccess` (`"Ajuste rechazado"`), `approveConfirmBody`, `rejectConfirmBody`, `commentLabel`, `commentPlaceholder`, `approveAction` (`"Aprobar"`), `rejectAction` (`"Rechazar"`).

- [ ] **Step 4 — Create `approve-adjustment-modal.tsx`** (R1 confirm-dialog variant, `maxWidth="max-w-md"`). Props: `{ adjustmentId: string; employeeName: string; mode: 'approve' | 'reject'; onClose: () => void }`. State: `comment` (string). Body text = `mode === 'approve' ? t.compensation.approveConfirmBody : t.compensation.rejectConfirmBody` interpolated with `employeeName` (build via template in JSX expression so it's not a flagged literal — values come from `t.*` + variable). Optional `<textarea maxLength={500}>` for comment. Submit button label = `mode === 'approve' ? t.compensation.approveAction : t.compensation.rejectAction`. `submit.mutate({ id: adjustmentId, approved: mode === 'approve', comment: comment.trim() || undefined })`. `onSuccess` toasts `mode === 'approve' ? approveSuccess : rejectSuccess` and invalidates all five queries.

- [ ] **Step 5 — Add per-row actions in `PendingAdjustments`** (`comp-right-column.tsx`): add `const [target, setTarget] = useState<{ id: string; name: string; mode: 'approve'|'reject' } | null>(null)`; render two small buttons per row (`t.compensation.approveAction` / `t.compensation.rejectAction`) setting `target`; mount `{target && <ApproveAdjustmentModal adjustmentId={target.id} employeeName={target.name} mode={target.mode} onClose={() => setTarget(null)} />}`. Gate visibility with the module's existing `useCan()` if `comp-right-column.tsx` already imports it; otherwise leave ungated (server enforces `compensation:approve`).

- [ ] **Step 6 — Run tripwire → PASS; run slice gate → green.**

- [ ] **Step 7 — Commit**
```bash
git commit -am "feat(compensation): wire Approve/Reject Adjustment confirm modal"
```

---

## Slice 4 — Performance: Create OKR · Create Commitment · Log Coaching Session

> **Scope note:** All three mutations are real but have NO triggers. The header "Nueva evaluación" button (`page.tsx:62`) has **no backing model** — repurpose it to open the OKR modal and relabel it `t.performance.newOkr`. Add session + commitment triggers in `coaching-panel.tsx`. `createCoachingSession` has **no notes field** — notes are added later via `completeCoachingSession`; this slice only creates (topic required).

**Files:**
- Create: `apps/web/app/(admin)/people/performance/create-okr-modal.tsx`
- Create: `apps/web/app/(admin)/people/performance/create-commitment-modal.tsx`
- Create: `apps/web/app/(admin)/people/performance/log-coaching-modal.tsx`
- Modify: `apps/web/app/(admin)/people/performance/page.tsx` (header button `:62`)
- Modify: `apps/web/app/(admin)/people/performance/coaching-panel.tsx` (add two trigger buttons)
- Modify: `apps/web/lib/i18n/{es,en}.json` (namespace `performance`)
- Test: `tests/tier1/s4-performance-wiring.test.ts`

**Interfaces:**
- `performance.createOkr` — `{ userId: string(uuid), teamId?: string(uuid), title: string(1..500), period: string, keyResults?: { title: string(1..500), targetValue: number, unit?: string }[] }`. Invalidate: `performance.listOkrs`, `performance.getDashboardKpis`.
- `performance.createCommitment` — `{ employeeId: string(uuid), coachingSessionId?: string(uuid), description: string(1..1000), dueDate: Date(coerce, pass ISO string) }`. Invalidate: `performance.listCommitments`, `performance.myCommitments`, `performance.getDashboardKpis`.
- `performance.createCoachingSession` — `{ employeeId: string(uuid), leaderId: string(uuid), scheduledAt: Date(coerce), duration?: number(int>0), topic: string(1..500), type?: string='scheduled' }`. Invalidate: `performance.listCoachingSessions`, `performance.getDashboardKpis`.
- Reference for all three: `feedback-modal.tsx` (UserPicker) + `recognition-modal.tsx`.

- [ ] **Step 1 — Write the failing tripwire** `tests/tier1/s4-performance-wiring.test.ts`: `create-okr-modal.tsx`→`trpc.performance.createOkr.useMutation` + `utils.performance.listOkrs.invalidate`; `create-commitment-modal.tsx`→`createCommitment` + `listCommitments.invalidate`; `log-coaching-modal.tsx`→`createCoachingSession` + `listCoachingSessions.invalidate`; each has `<Modal`; `page.tsx`→`<CreateOkrModal`; `coaching-panel.tsx`→`<LogCoachingModal` + `<CreateCommitmentModal`; no `style={{`/`any`/`comingSoon` in the 3 modals; keys present both locales.

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Add i18n keys** to `performance` (BOTH locales). OKR: `newOkr`, `createOkrTitle`, `createOkrSuccess`, `objectiveLabel`, `objectivePlaceholder`, `ownerLabel`, `periodLabel`, `periodPlaceholder`, `keyResultsLabel`, `addKeyResult`, `krTitlePlaceholder`, `krTargetPlaceholder`. Commitment: `createCommitmentTitle`, `createCommitmentSuccess`, `descriptionLabel`, `descriptionPlaceholder`, `dueDateLabel`, `newCommitment`. Coaching: `logCoachingTitle`, `logCoachingSuccess`, `employeeLabel`, `coachLabel`, `dateLabel`, `topicLabel`, `topicPlaceholder`, `durationLabel`, `logCoachingAction`.

- [ ] **Step 4 — Create `create-okr-modal.tsx`** (R1). State: `owner` (`PickedUser|null` via UserPicker → `userId`), `title`, `period` (text input, placeholder e.g. "Q3-2026"), `keyResults` (`{ title: string; targetValue: string }[]`, default one row; convert `targetValue` to `Number()` on submit, skip empty rows). `canSubmit = !!owner && title.trim() && period.trim() && !submit.isPending`. `submit.mutate({ userId: owner.id, title: title.trim(), period: period.trim(), keyResults: keyResults.filter(k => k.title.trim()).map(k => ({ title: k.title.trim(), targetValue: Number(k.targetValue) || 0 })) })`. Invalidate listOkrs + getDashboardKpis.

- [ ] **Step 5 — Create `create-commitment-modal.tsx`** (R1). State: `owner` (`PickedUser|null` → `employeeId`), `description` (`<textarea maxLength={1000}>`), `dueDate` (`<input type="date">` string). `canSubmit = !!owner && description.trim() && !!dueDate && !submit.isPending`. `submit.mutate({ employeeId: owner.id, description: description.trim(), dueDate: new Date(dueDate).toISOString() })`. Invalidate listCommitments + myCommitments + getDashboardKpis.

- [ ] **Step 6 — Create `log-coaching-modal.tsx`** (R1). State: `employee` (`PickedUser|null` → `employeeId`), `coach` (`PickedUser|null` → `leaderId`; second UserPicker), `scheduledAt` (`<input type="date">`), `topic` (text), `duration` (string, optional → `Number` minutes). `canSubmit = !!employee && !!coach && !!scheduledAt && topic.trim() && !submit.isPending`. `submit.mutate({ employeeId: employee.id, leaderId: coach.id, scheduledAt: new Date(scheduledAt).toISOString(), topic: topic.trim(), duration: duration ? Number(duration) : undefined })`. Invalidate listCoachingSessions + getDashboardKpis.

- [ ] **Step 7 — Wire triggers.** `page.tsx`: relabel button `:62` to `t.performance.newOkr`, `onClick={() => setShowOkr(true)}`, mount `<CreateOkrModal>`. `coaching-panel.tsx`: add a "Registrar sesión" button (`t.performance.logCoachingAction`) → `<LogCoachingModal>` and a "Nuevo compromiso" button (`t.performance.newCommitment`) → `<CreateCommitmentModal>`, each with its own open-state + conditional mount. (Leave the existing "Ver todos" stub as-is — it's a Tier-2 list view, out of scope.)

- [ ] **Step 8 — Run tripwire → PASS; run slice gate → green.**

- [ ] **Step 9 — Commit**
```bash
git commit -am "feat(performance): wire Create OKR / Commitment / Log Coaching modals"
```

---

## Slice 5 — Learning: Enroll

> **Scope note:** No enroll/complete buttons exist; catalog cards are read-only. This slice adds an **Enroll** action per course card → `learning.enrollUser`. **"Complete" is deferred** (no admin enrollment-list surface exists; `updateProgress(100)` needs an enrollment-list view = its own future slice). **Do NOT touch** the `Math.random()` progress at `course-catalog.tsx:110` (Tier-2).

**Files:**
- Create: `apps/web/app/(admin)/learning/enroll-modal.tsx`
- Modify: `apps/web/app/(admin)/learning/course-catalog.tsx` (add per-card Enroll button + open state; leave line 110 untouched)
- Modify: `apps/web/lib/i18n/{es,en}.json` (namespace `learning`)
- Test: `tests/tier1/s5-learning-wiring.test.ts`

**Interfaces:**
- `learning.enrollUser` — `{ userId: string(uuid), courseId: string(uuid) }`. Invalidate: `learning.listCourses`, `learning.getDashboardKpis`.
- Consumes course `id` + `title` from the catalog card scope.

- [ ] **Step 1 — Write the failing tripwire** `tests/tier1/s5-learning-wiring.test.ts`: `enroll-modal.tsx`→`trpc.learning.enrollUser.useMutation` + `utils.learning.listCourses.invalidate` + `<Modal`; `course-catalog.tsx`→`<EnrollModal`; modal has no `style={{`/`any`/`comingSoon`; assert `course-catalog.tsx` STILL contains `Math.random` (proves we didn't refactor Tier-2 by accident) ; keys `t.learning.enrollTitle` + `.enrollSuccess` both locales.

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Add i18n keys** to `learning` (BOTH locales): `enrollTitle` (`"Inscribir empleado"`), `enrollSuccess` (`"Empleado inscrito"`), `enrollAction` (`"Inscribir"`), `courseLabel` (`"Curso"`), `employeeLabel` (`"Empleado"`).

- [ ] **Step 4 — Create `enroll-modal.tsx`** (R1). Props: `{ courseId: string; courseTitle: string; onClose: () => void }`. State: `employee` (`PickedUser|null` via UserPicker → `userId`). Show the course title (read-only line, value from prop). `canSubmit = !!employee && !submit.isPending`. `submit.mutate({ userId: employee.id, courseId })`. Invalidate listCourses + getDashboardKpis.

- [ ] **Step 5 — Add per-card Enroll button** in `course-catalog.tsx`: add `const [enrollCourse, setEnrollCourse] = useState<{ id: string; title: string } | null>(null)`; inside the card (`:113-140`) add an "Inscribir" button (`t.learning.enrollAction`, `type="button"`, `stopPropagation` if the card has its own handler) → `setEnrollCourse({ id: course.id, title: course.title })`; mount once `{enrollCourse && <EnrollModal courseId={enrollCourse.id} courseTitle={enrollCourse.title} onClose={() => setEnrollCourse(null)} />}`. Do not modify line 110.

- [ ] **Step 6 — Run tripwire → PASS; run slice gate → green.**

- [ ] **Step 7 — Commit**
```bash
git commit -am "feat(learning): wire per-course Enroll modal to learning.enrollUser"
```

---

## Slice 6 — Onboarding: Toggle Task (inline) + Create Plan

> **Scope note:** `createPlan` is `onboarding.create`. Inline toggle is `onboarding.updateTask({ id, completed })`. No per-task checkbox exists — tasks come down inside `onboarding.list` rows; add an expandable per-task checklist to `onboarding-table.tsx`.

**Files:**
- Create: `apps/web/app/(admin)/people/onboarding/create-plan-modal.tsx`
- Modify: `apps/web/app/(admin)/people/onboarding/page.tsx` (button `:111`)
- Modify: `apps/web/app/(admin)/people/onboarding/onboarding-table.tsx` (expandable task rows + checkbox → updateTask)
- Modify: `apps/web/lib/i18n/{es,en}.json` (namespace `onboarding`)
- Test: `tests/tier1/s6-onboarding-wiring.test.ts`

**Interfaces:**
- `onboarding.create` — `{ userId: string(uuid), buddyId?: string(uuid), startDate: Date(coerce), phase?: string='day1_30' }`. Invalidate: `onboarding.list`, `onboarding.getDashboardKpis`.
- `onboarding.updateTask` — `{ id: string(uuid), completed?: boolean }` (also accepts title/desc/etc — send only `{ id, completed }`). Invalidate: `onboarding.list`, `onboarding.getDashboardKpis`.
- Consumes: `plan.tasks` (each `{ id, title, completed }`) already present on `onboarding.list` rows — confirm the selected shape in the router and type accordingly.

- [ ] **Step 1 — Write the failing tripwire** `tests/tier1/s6-onboarding-wiring.test.ts`: `create-plan-modal.tsx`→`trpc.onboarding.create.useMutation` + `utils.onboarding.list.invalidate` + `<Modal`; `onboarding-table.tsx`→`trpc.onboarding.updateTask.useMutation` + a checkbox `onChange` wiring + `utils.onboarding.list.invalidate`; `page.tsx`→`<CreatePlanModal`; no `style={{`/`any`/`comingSoon` in new code; keys `t.onboarding.createPlanTitle` + `.createPlanSuccess` + `.taskToggleSuccess` both locales.

- [ ] **Step 2 — Run it, verify it fails.**

- [ ] **Step 3 — Add i18n keys** to `onboarding` (BOTH locales): `createPlanTitle` (`"Nuevo onboarding"`), `createPlanSuccess` (`"Plan creado"`), `newHireLabel` (`"Nuevo ingreso"`), `buddyLabel` (`"Buddy"`), `startDateLabel` (`"Fecha de inicio"`), `phaseLabel` (`"Fase"`), `taskToggleSuccess` (`"Tarea actualizada"`), `tasksLabel` (`"Tareas"`), `expandTasks` (`"Ver tareas"`).

- [ ] **Step 4 — Create `create-plan-modal.tsx`** (R1). State: `newHire` (`PickedUser|null` → `userId`), `buddy` (`PickedUser|null` → `buddyId`, second UserPicker, optional), `startDate` (`<input type="date">`), `phase` (`<select>` default `'day1_30'` — options `day1_30`/`day31_60`/`day61_90` with `t` labels, or a single default if the codebase only uses `day1_30`). `canSubmit = !!newHire && !!startDate && !submit.isPending`. `submit.mutate({ userId: newHire.id, buddyId: buddy?.id, startDate: new Date(startDate).toISOString(), phase })`. Invalidate `onboarding.list` + `onboarding.getDashboardKpis`.

- [ ] **Step 5 — Wire create trigger** `page.tsx`: `useState` open flag; button `:111` → `setShowCreate(true)`; mount `<CreatePlanModal>`.

- [ ] **Step 6 — Add expandable task checklist** in `onboarding-table.tsx`: add row-expand state (`const [expanded, setExpanded] = useState<string | null>(null)`), a toggle control per plan row (`t.onboarding.expandTasks`); when expanded, render `plan.tasks` as a list, each a `<label>` + `<input type="checkbox" checked={task.completed}>`; on change call a `toggleTask` mutation:
```ts
const utils = trpc.useUtils();
const toggleTask = trpc.onboarding.updateTask.useMutation({
  onSuccess: () => { utils.onboarding.list.invalidate(); utils.onboarding.getDashboardKpis.invalidate(); toast(t.onboarding.taskToggleSuccess, { type: 'success' }); },
  onError: (err) => toast(err.message, { type: 'error' }),
});
// checkbox onChange={(e) => toggleTask.mutate({ id: task.id, completed: e.target.checked })}
```
Type the task as a local interface (`{ id: string; title: string; completed: boolean }`), no `any`. Keep `onboarding-table.tsx` under the 300-line component limit — if it would exceed, extract the expanded checklist into a small `onboarding-task-list.tsx` sibling (do this if needed; the tripwire test just checks `onboarding-table.tsx` references it or contains the wiring).

- [ ] **Step 7 — Run tripwire → PASS; run slice gate → green.**

- [ ] **Step 8 — Commit**
```bash
git commit -am "feat(onboarding): wire Create Plan modal + inline task toggle"
```

---

## Final — Whole-branch review & finish

- [ ] **Opus whole-branch review** (fresh reviewer): correctness of every mutation input mapping vs router Zod, all invalidations present, i18n parity (es/en key shape identical), no `any`/inline-style/hardcoded-string regressions, the `activateSurvey` backend addition is scope-guarded, `course-catalog.tsx:110` untouched, file-size limits respected. Address findings.
- [ ] **Full gate** `pnpm --filter @tims/api exec tsc --noEmit` && `cd apps/web && npx tsc --noEmit` && `npx vitest run` (or `/gate`) → all green.
- [ ] **superpowers:finishing-a-development-branch** → push → PR (`feat/tier1-last-mile-wiring`) → admin-merge past the CI billing trap if that's the only red → Vercel auto-deploy.
- [ ] **Update memory** `tims-tier1-last-mile-wiring` → status shipped; record the 3 plan-time decisions (useState pattern, activateSurvey added, Learning-complete deferred).

---

## Self-Review (against spec)

- **Spec §S1–S6 coverage:** S1 ✅ as specced. S2 ✅ + sanctioned `activateSurvey`. S3 ✅ (net-new control, approve+reject). S4 ✅ all three creates (no `createEvaluation` exists — header button repurposed to OKR). S5 ✅ enroll; **"complete" deferred** (documented — no enrollment-list surface). S6 ✅ create + inline toggle (added expandable checklist). All targeted mutations confirmed REAL by exploration; none dropped as stubs.
- **Out-of-scope respected:** no Export buttons, no Simulate, `Math.random` progress left untouched (S5 tripwire asserts it remains).
- **Testing:** static tripwire per slice + behavioral units for S2 question-builder helpers + S2 backend `activateSurvey` test. Gate = api tsc + web tsc + full vitest (incl. i18n gate).
- **Pattern consistency:** every modal instantiates R1 (useState, no RHF). Type names consistent: `PickedUser` (picker), `submit`/`create`/`activate`/`toggleTask` mutation handles, `utils.<router>.<query>.invalidate()`.
- **Deviations from spec wording (all user-approved):** form lib = useState not RHF; S2 gains one backend mutation; several slices add net-new controls rather than swapping an existing stub (Compensation, Performance, Learning, Onboarding-toggle had no pre-existing button).
