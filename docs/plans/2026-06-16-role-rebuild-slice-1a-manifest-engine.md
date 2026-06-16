# Role Rebuild — Slice 1a (Manifest Engine + Recruiter Landing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the admin sidebar's subtractive nav ("one hardcoded list minus what you can't `read`") with a pure, testable, per-role **manifest** that declares each role's sections, with `can()` as a safety filter on top — proving the engine on the recruiter (purpose-built ATS nav) and super_admin (full nav) roles with zero regression for the rest.

**Architecture:** A pure data module (`apps/web/lib/nav/manifest.ts`) declares `MANIFESTS: Record<NavRole, RoleManifest>`. `manifestFor(roles)` picks the highest-precedence role's manifest; `computeVisibleSections(sections, can, isLoading)` prunes items the user can't read (UX only — the tRPC API stays the real boundary). The `Sidebar` component renders the manifest instead of its hardcoded `useNavSections()`. The route→module map (`PATH_MODULE`) is extracted to a pure module so both the manifest and tests can import it without pulling in React.

**Tech Stack:** Next.js 15 App Router (client components), React, TypeScript (strict), Vitest. i18n via `apps/web/lib/i18n` (`t.sidebar.*`, Spanish default). Tests at repo-root `tests/`.

**Source of truth:** `ROLE-EXPERIENCE-REBUILD-SPEC.md` §1 (manifest-driven, `can()` = safety filter, 2 shells) + §3 (per-role IA). Slice 0 (substrate) is live in prod.

---

## Scoping decisions (locked with Federico, 2026-06-16)

| Decision | Resolution |
|---|---|
| Org Command Center depth | **Lean purpose-built v1** (reuse existing endpoints) — built in **Slice 1b**, not here |
| Slice 1 structure | **Split 1a / 1b.** This plan = 1a (engine + recruiter landing + routing foundation). 1b = Org Command Center. |
| Participant shell | **Deferred to Slice 4** (where committee/employee actually use it). 1a only establishes the manifest's `shell` dimension; building an unused shell now is waste. The manifest type carries `shell: 'admin' \| 'participant' \| 'platform'` but 1a wires only `'admin'`. |
| Multi-role users | **Primary-role manifest wins** (highest `ROLE_PRECEDENCE`), per spec §1. `can()` still gates URL access, so nothing becomes reachable that shouldn't be. |
| Non-target admin roles (hr_admin, hrbp, leader, committee, employee) | Use a **base manifest = the current full section list** → identical to today's behavior after `can()` filtering (no regression). Refined in their own slices (2–4). |
| Recruiter landing | Already exists as `RecruiterDashboard` (= Recruiting Command Center). 1a **declares** it via the manifest `landing` field; no dashboard rewrite. |

**What is NOT in 1a:** Org Command Center (1b), the Administration nav section (its org-settings/users/audit pages don't exist — deferred per D5 "omit unbuilt"), the participant shell (Slice 4), redirect-logic changes (all admin landings are still `/dashboard`).

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/lib/nav/routes.ts` | **NEW.** Pure route→module map (`PATH_MODULE`, `moduleForPath`). No React. | Create (move from `permissions.tsx`) |
| `apps/web/lib/permissions.tsx` | Client permissions context | Re-export `PATH_MODULE`/`moduleForPath` from `routes.ts` (back-compat); no behavior change |
| `apps/web/lib/nav/manifest.ts` | **NEW.** Pure nav data: types, section sets, `MANIFESTS`, `manifestFor`, `resolveLabel`, `computeVisibleSections`. No React. | Create |
| `apps/web/app/(admin)/sidebar.tsx` | The admin sidebar component | Render from the manifest instead of `useNavSections()` |
| `tests/nav/routes.test.ts` | **NEW.** Pins `moduleForPath` longest-prefix behavior | Create |
| `tests/nav/manifest.test.ts` | **NEW.** Pins manifest invariants + `computeVisibleSections` + label resolution | Create |

---

## Task 1: Extract the route→module map into a pure, importable module

`PATH_MODULE`/`moduleForPath` currently live in `permissions.tsx`, which is `'use client'` and imports React/tRPC — so a Vitest (node) test or the pure manifest can't import them without dragging React in. Extract them to a pure module.

**Files:**
- Create: `apps/web/lib/nav/routes.ts`
- Modify: `apps/web/lib/permissions.tsx:19-73`
- Test: `tests/nav/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/nav/routes.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { PATH_MODULE, moduleForPath } from '../../apps/web/lib/nav/routes';

describe('route→module map', () => {
  it('exact match returns the module', () => {
    expect(moduleForPath('/recruitment/candidates')).toBe('candidate');
  });
  it('child path matches by longest prefix', () => {
    expect(moduleForPath('/recruitment/candidates/abc-123')).toBe('candidate');
  });
  it('null-module routes return null (always allowed)', () => {
    expect(moduleForPath('/dashboard')).toBe(null);
  });
  it('unmapped route returns undefined (treated as allowed)', () => {
    expect(moduleForPath('/nope/nowhere')).toBeUndefined();
  });
  it('PATH_MODULE still covers the known admin routes', () => {
    expect(PATH_MODULE['/talent/team-intelligence']).toBe('team_intel');
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx vitest run tests/nav/routes.test.ts`
Expected: FAIL — `Cannot find module '.../apps/web/lib/nav/routes'`.

- [ ] **Step 3: Create the pure module**

Create `apps/web/lib/nav/routes.ts` by moving `PATH_MODULE` (currently `permissions.tsx:19-46`) and `moduleForPath` (`permissions.tsx:65-73`) VERBATIM. No `'use client'`, no React imports:
```typescript
// Route → module map. Single source of truth shared by the shell RouteAccessGuard,
// the sidebar manifest, and tests. Prefix match, LONGEST-FIRST. `null` = always
// allowed. UX only — the tRPC API is the real enforcement boundary.
export const PATH_MODULE: Record<string, string | null> = {
  '/dashboard': null,
  '/recruitment/pipeline': 'pipeline',
  '/recruitment/vacancies': 'vacancy',
  '/recruitment/candidates': 'candidate',
  '/recruitment/interviews': 'interview',
  '/recruitment/assessments': 'assessment',
  '/recruitment/offers': 'offer',
  '/recruitment/talent-pools': 'candidate',
  '/recruitment/analytics': 'vacancy',
  '/people/onboarding': 'onboarding',
  '/people/performance': 'performance',
  '/learning': 'learning',
  '/talent/nine-box': 'ninebox',
  '/talent/succession': 'succession',
  '/talent/team-intelligence': 'team_intel',
  '/engagement/climate': 'engagement',
  '/engagement/dei': 'dei',
  '/compensation': 'compensation',
  '/monitoring': 'monitoring',
  '/settings/billing': 'billing',
  '/settings/integrations': 'integration',
  '/settings/business-units': 'user',
  '/settings': null,
  '/platform': null,
  '/mfa': null,
  '/profile': null,
};

export function moduleForPath(pathname: string): string | null | undefined {
  let best: { key: string; module: string | null } | undefined;
  for (const [key, module] of Object.entries(PATH_MODULE)) {
    if (pathname === key || pathname.startsWith(`${key}/`)) {
      if (!best || key.length > best.key.length) best = { key, module };
    }
  }
  return best?.module;
}
```

- [ ] **Step 4: Re-export from `permissions.tsx` (back-compat, no behavior change)**

In `apps/web/lib/permissions.tsx`, DELETE the `PATH_MODULE` const (lines 19-46) and the `moduleForPath` function (lines 65-73), and add near the top imports:
```typescript
export { PATH_MODULE, moduleForPath } from './nav/routes';
```
Leave the explanatory comment block and everything else (`ROLE_PRECEDENCE`, `RoleSlug`, the context, `can`, etc.) unchanged. Verify `sidebar.tsx` and any other importer of `moduleForPath`/`PATH_MODULE` from `'../../lib/permissions'` still resolve (they will — the re-export preserves the path).

- [ ] **Step 5: Run the test + tsc**

Run: `npx vitest run tests/nav/routes.test.ts` → PASS (5 cases).
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `grep -rn "moduleForPath\|PATH_MODULE" apps/web --include=*.tsx --include=*.ts -l` → confirm every importer still imports from `'../../lib/permissions'` or the new `routes` path and compiles.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/nav/routes.ts apps/web/lib/permissions.tsx tests/nav/routes.test.ts
git commit -m "refactor(web): extract PATH_MODULE/moduleForPath into pure nav/routes module"
```

---

## Task 2: The pure nav manifest module

**Files:**
- Create: `apps/web/lib/nav/manifest.ts`
- Test: `tests/nav/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/nav/manifest.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  MANIFESTS, manifestFor, resolveLabel, computeVisibleSections, NAV_ROLES,
} from '../../apps/web/lib/nav/manifest';
import { moduleForPath } from '../../apps/web/lib/nav/routes';
import es from '../../apps/web/lib/i18n/es.json';

describe('nav manifest', () => {
  it('manifestFor picks the highest-precedence role', () => {
    expect(manifestFor(['recruiter'])).toBe(MANIFESTS.recruiter);
    expect(manifestFor(['recruiter', 'hr_admin'])).toBe(MANIFESTS.hr_admin); // hr_admin outranks recruiter
    expect(manifestFor(['employee'])).toBe(MANIFESTS.employee);
  });
  it('falls back to a base manifest for unknown/empty roles', () => {
    expect(manifestFor([]).sections.length).toBeGreaterThan(0);
  });
  it('recruiter manifest is purpose-built ATS — no people/talent/culture modules', () => {
    const forbidden = new Set(['performance', 'onboarding', 'learning', 'ninebox', 'succession', 'team_intel', 'engagement', 'dei', 'compensation', 'monitoring', 'billing', 'integration', 'user']);
    for (const s of MANIFESTS.recruiter.sections)
      for (const it of s.items)
        expect(forbidden.has(it.module ?? ''), `recruiter should not nav to ${it.module}`).toBe(false);
  });
  it('super_admin manifest is the full base (has people + talent + culture)', () => {
    const modules = MANIFESTS.super_admin.sections.flatMap((s) => s.items.map((i) => i.module));
    expect(modules).toContain('performance');
    expect(modules).toContain('ninebox');
    expect(modules).toContain('engagement');
  });
  it('NO-DRIFT: every manifest item.module matches the route map for its href', () => {
    for (const role of NAV_ROLES)
      for (const s of MANIFESTS[role].sections)
        for (const it of s.items)
          expect(moduleForPath(it.href) ?? null, `${role} ${it.href}`).toBe(it.module ?? null);
  });
  it('every label key resolves to a non-empty Spanish string', () => {
    for (const role of NAV_ROLES)
      for (const s of MANIFESTS[role].sections) {
        if (s.labelKey) expect(resolveLabel(es, s.labelKey)).toBeTruthy();
        for (const it of s.items) {
          const label = resolveLabel(es, it.labelKey);
          expect(label, `${it.labelKey}`).toBeTruthy();
          expect(label).not.toBe(it.labelKey); // actually resolved, not the raw key
        }
      }
  });
});

describe('computeVisibleSections', () => {
  const base = MANIFESTS.super_admin.sections;
  it('hides gated items while loading (only null-module items show)', () => {
    const out = computeVisibleSections(base, () => true, true);
    for (const s of out) for (const it of s.items) expect(it.module).toBe(null);
  });
  it('after load, keeps items where module===null OR can(module) is true', () => {
    const canOnlyPipeline = (m: string) => m === 'pipeline';
    const out = computeVisibleSections(base, canOnlyPipeline, false);
    const modules = out.flatMap((s) => s.items.map((i) => i.module));
    expect(modules).toContain(null);        // command center always
    expect(modules).toContain('pipeline');  // allowed
    expect(modules).not.toContain('dei');   // denied → pruned
  });
  it('drops sections that end up empty', () => {
    const out = computeVisibleSections(base, () => false, false);
    for (const s of out) expect(s.items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `npx vitest run tests/nav/manifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the manifest module**

Create `apps/web/lib/nav/manifest.ts`. Pure data — no `'use client'`, no React, no i18n runtime import (the `t` object is passed in):
```typescript
import type { Module } from '@tims/shared';

export type NavItem = { href: string; labelKey: string; icon: string; module: Module | null };
export type NavSection = { labelKey: string | null; items: NavItem[] };
export type Shell = 'admin' | 'participant' | 'platform';
export type RoleManifest = { shell: Shell; landing: string; sections: NavSection[] };

export const NAV_ROLES = [
  'super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee',
] as const;
export type NavRole = (typeof NAV_ROLES)[number];

// Highest-precedence first (mirrors ROLE_PRECEDENCE in permissions.tsx, minus platform_owner
// which renders the separate PlatformSidebar). The primary role wins for nav.
const PRECEDENCE: NavRole[] = ['super_admin', 'hr_admin', 'hrbp', 'recruiter', 'leader', 'committee', 'employee'];

// --- Section building blocks (label keys are dot-paths into the i18n message object) ---
const COMMAND_CENTER: NavSection = {
  labelKey: null,
  items: [{ href: '/dashboard', labelKey: 'sidebar.commandCenter', icon: 'grid', module: null }],
};
const RECRUITMENT: NavSection = {
  labelKey: 'sidebar.recruitment',
  items: [
    { href: '/recruitment/pipeline', labelKey: 'sidebar.pipeline', icon: 'kanban', module: 'pipeline' },
    { href: '/recruitment/vacancies', labelKey: 'sidebar.vacancies', icon: 'briefcase', module: 'vacancy' },
    { href: '/recruitment/candidates', labelKey: 'sidebar.candidates', icon: 'user', module: 'candidate' },
    { href: '/recruitment/interviews', labelKey: 'sidebar.interviews', icon: 'video', module: 'interview' },
    { href: '/recruitment/assessments', labelKey: 'sidebar.assessments', icon: 'clipboard', module: 'assessment' },
    { href: '/recruitment/offers', labelKey: 'sidebar.offers', icon: 'clipboard', module: 'offer' },
    { href: '/recruitment/talent-pools', labelKey: 'sidebar.talentPool', icon: 'users', module: 'candidate' },
    { href: '/recruitment/analytics', labelKey: 'sidebar.analytics', icon: 'chart', module: 'vacancy' },
  ],
};
const PEOPLE: NavSection = {
  labelKey: 'sidebar.people',
  items: [
    { href: '/people/onboarding', labelKey: 'sidebar.onboarding', icon: 'rocket', module: 'onboarding' },
    { href: '/people/performance', labelKey: 'sidebar.performance', icon: 'target', module: 'performance' },
    { href: '/learning', labelKey: 'sidebar.training', icon: 'book', module: 'learning' },
  ],
};
const TALENT: NavSection = {
  labelKey: 'sidebar.talent',
  items: [
    { href: '/talent/nine-box', labelKey: 'sidebar.nineBox', icon: 'ninebox', module: 'ninebox' },
    { href: '/talent/succession', labelKey: 'sidebar.succession', icon: 'succession', module: 'succession' },
    { href: '/talent/team-intelligence', labelKey: 'sidebar.teamIntel', icon: 'team', module: 'team_intel' },
  ],
};
const CULTURE: NavSection = {
  labelKey: 'sidebar.organization',
  items: [
    { href: '/engagement/climate', labelKey: 'sidebar.climate', icon: 'heart', module: 'engagement' },
    { href: '/engagement/dei', labelKey: 'sidebar.dei', icon: 'dei', module: 'dei' },
    { href: '/compensation', labelKey: 'sidebar.compensation', icon: 'dollar', module: 'compensation' },
    { href: '/monitoring', labelKey: 'sidebar.monitoring', icon: 'monitor', module: 'monitoring' },
  ],
};
const SETTINGS: NavSection = {
  labelKey: null,
  items: [
    { href: '/settings/business-units', labelKey: 'sidebar.businessUnits', icon: 'team', module: 'user' },
    { href: '/settings/billing', labelKey: 'sidebar.billing', icon: 'dollar', module: 'billing' },
    { href: '/settings/integrations', labelKey: 'sidebar.integrations', icon: 'settings', module: 'integration' },
  ],
};

// Base admin IA = today's full sidebar. `can()` prunes per role → no regression.
const BASE_ADMIN: NavSection[] = [COMMAND_CENTER, RECRUITMENT, PEOPLE, TALENT, CULTURE, SETTINGS];
// Recruiter = purpose-built ATS shell (declared, not subtracted).
const RECRUITER_ATS: NavSection[] = [COMMAND_CENTER, RECRUITMENT];

const adminManifest = (sections: NavSection[]): RoleManifest => ({ shell: 'admin', landing: '/dashboard', sections });

export const MANIFESTS: Record<NavRole, RoleManifest> = {
  super_admin: adminManifest(BASE_ADMIN),
  hr_admin: adminManifest(BASE_ADMIN),
  hrbp: adminManifest(BASE_ADMIN),
  recruiter: adminManifest(RECRUITER_ATS),
  leader: adminManifest(BASE_ADMIN),
  committee: adminManifest(BASE_ADMIN), // participant shell arrives in Slice 4
  employee: adminManifest(BASE_ADMIN),  // participant shell arrives in Slice 4
};

/** The manifest for the user's primary (highest-precedence) role. */
export function manifestFor(roles: readonly string[]): RoleManifest {
  const primary = PRECEDENCE.find((r) => roles.includes(r));
  return primary ? MANIFESTS[primary] : adminManifest(BASE_ADMIN);
}

type NestedMessages = { [k: string]: string | NestedMessages };
/** Resolve a dot-path label key against an i18n message object. Falls back to the key. */
export function resolveLabel(t: NestedMessages, key: string): string {
  const v = key.split('.').reduce<string | NestedMessages | undefined>(
    (o, k) => (o && typeof o === 'object' ? o[k] : undefined),
    t,
  );
  return typeof v === 'string' ? v : key;
}

/** Prune sections to what the user may see. UX only — the API is the real gate.
 *  While loading, show only null-module items (no flash-then-vanish). */
export function computeVisibleSections(
  sections: NavSection[],
  can: (module: string, action?: string) => boolean,
  isLoading: boolean,
): NavSection[] {
  return sections
    .map((s) => ({
      ...s,
      items: s.items.filter((it) => {
        if (it.module === null) return true;
        if (isLoading) return false;
        return can(it.module, 'read');
      }),
    }))
    .filter((s) => s.items.length > 0);
}
```

- [ ] **Step 4: Run the test, verify it PASSES**

Run: `npx vitest run tests/nav/manifest.test.ts`
Expected: PASS (all cases, incl. no-drift + label resolution).

- [ ] **Step 5: Type-check**

Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/nav/manifest.ts tests/nav/manifest.test.ts
git commit -m "feat(web): add pure role→nav manifest engine (manifestFor + computeVisibleSections)"
```

---

## Task 3: Render the Sidebar from the manifest

**Files:**
- Modify: `apps/web/app/(admin)/sidebar.tsx` (replace `useNavSections()` usage; keep `Icon`, layout, user footer)

- [ ] **Step 1: Confirm the context exposes `roles`**

Read `apps/web/lib/permissions.tsx` around the `PermissionsContextValue` interface (~line 75) and the provider. Confirm `usePermissions()` returns `roles: string[]`. (Per exploration it does.) If it does NOT, add `roles` to the context value and provider (it already builds roles from `data.roles`) — note this in your report.

- [ ] **Step 2: Rewrite the nav source in `sidebar.tsx`**

Replace the `useNavSections()` function (lines 9-56) — DELETE it entirely. Update the imports (lines 6-7) to:
```typescript
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel } from '../../lib/nav/manifest';
```
In the `Sidebar` component body (currently lines 105-121), replace:
```typescript
  const { can, roleLabel, isLoading } = usePermissions();
  const NAV_SECTIONS = useNavSections();

  const VISIBLE_SECTIONS = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (item.module === null) return true;
      if (isLoading) return false;
      return can(item.module, 'read');
    }),
  })).filter((section) => section.items.length > 0);
```
with:
```typescript
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);
```

- [ ] **Step 3: Resolve label keys in the render**

The manifest stores `labelKey` (a dot-path) instead of a resolved string. In the nav render (currently lines 146-186), update the two label reads:
- Section label (line 153): `{section.label}` → `{section.labelKey ? resolveLabel(t, section.labelKey) : null}` (and the guard on line 151 `section.label &&` → `section.labelKey &&`).
- Item label: every `item.label` (lines 163, 178) → `resolveLabel(t, item.labelKey)`.

`t` is already in scope (`const { t } = useI18n();` line 107). Cast note: `resolveLabel` takes `NestedMessages`; `t` is the typed message object — pass it directly (it is structurally a nested string record). If tsc complains, pass `t as unknown as Parameters<typeof resolveLabel>[0]` — but prefer no cast; the structural type should satisfy.

Leave EVERYTHING else in `sidebar.tsx` unchanged: the `Icon` component, the `aside`/logo/`nav` layout, the collapse toggle, and the user/MFA/logout footer.

- [ ] **Step 4: Type-check + full suite**

Run: `cd apps/web && npx tsc --noEmit && cd ../..` → 0 errors.
Run: `npx vitest run` → full suite green (paste tally).

- [ ] **Step 5: Build (catches client/server bundling issues)**

Run: `cd apps/web && pnpm build && cd ../..`
Expected: `✓ Compiled successfully`, full route table, no errors. (`apps/web/lib/nav/manifest.ts` and `routes.ts` must stay React-free so they bundle into the client component cleanly.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/(admin)/sidebar.tsx packages/  # include permissions.tsx if you added `roles` to the context
git commit -m "feat(web): drive admin sidebar from the role nav manifest (recruiter gets purpose-built ATS nav)"
```

---

## Task 4: Verification

**Files:** none (verification only).

- [ ] **Step 1: Gate**

Run: `cd apps/web && npx tsc --noEmit && cd ../.. && npx vitest run`
Expected: tsc 0 errors; full suite green.

- [ ] **Step 2: Manual nav parity check (no regression for base roles)**

Reason through (or, if a dev server is available, log in as) each role and confirm the manifest output equals today's filtered sidebar:
- **super_admin / hr_admin / hrbp / leader / committee / employee** → `manifestFor` returns `BASE_ADMIN`; after `can()` filtering the visible items are identical to today's subtractive output (BASE_ADMIN == the old hardcoded list). No item appears or disappears versus `main`.
- **recruiter** → `manifestFor` returns `RECRUITER_ATS`. Visible nav = Command Center + Recruitment only. This equals today's *filtered* result for recruiter (recruiter has no people/talent/culture grants), but is now **declared**, not emergent.

- [ ] **Step 3: `/gate`**

Run: `/gate`
Expected: green (tsc + tests + build + gitleaks).

---

## Self-Review

**Spec coverage (§1 manifest-driven nav):**
- Manifest drives nav, `can()` = safety filter → Tasks 2 + 3. ✓
- Per-role IA (recruiter purpose-built, others base) → Task 2 `MANIFESTS`. ✓
- Pure/testable manifest → Tasks 1 + 2 (no-drift + label-resolution invariants). ✓
- 2-shell `shell` dimension present; participant shell deferred to Slice 4 (scope decision, flagged). ✓
- super_admin landing (Org Command Center) → **Slice 1b** (out of scope here, by the split decision). Recruiter landing declared via manifest. ✓

**Placeholder scan:** none — every step shows exact code.

**Type consistency:** `NavItem`/`NavSection`/`RoleManifest`/`manifestFor`/`computeVisibleSections`/`resolveLabel` defined in Task 2, consumed identically in Task 3 and the tests. `moduleForPath` signature unchanged across Task 1.

**Regression guard:** BASE_ADMIN is byte-equivalent to the old `useNavSections()` list (same hrefs/labels/icons/modules), so all non-recruiter roles render identically; the no-drift test pins `item.module === moduleForPath(href)`.

---

## Slice 1b — Org Command Center (outline; detail after 1a ships)

Lean, purpose-built v1 of super_admin's landing, reusing existing endpoints. To be turned into a full TDD plan after 1a is live (fresh exploration of the dashboard data layer first).

- **New component** `apps/web/app/(admin)/dashboard/org-command-center.tsx` — org-health rollup using existing endpoints: org-wide recruiting funnel (`recruitmentAnalytics.getKpis`/`getFunnel`), open reqs + headcount (`vacancy.getDashboardKpis`, a headcount count), engagement pulse (`engagement.*`, already min-5 suppressed), and a DEI/comp tile where data exists. Reuse `KpiCard`/`Skeleton`/`EmptyState` + the chart primitives from `recruiting-kpi-strip`/`pipeline-funnel`.
- **Wire the landing** — in `apps/web/app/(admin)/dashboard/page.tsx` (or `recruitment-dashboard.tsx`), render `OrgCommandCenter` for super_admin org users instead of `RecruiterDashboard`; fix the committee→leader mis-bucket while here. Set `MANIFESTS.super_admin.landing` accordingly (stays `/dashboard`, new component).
- **Sensitive-data consistency** — any sub-5 aggregate (DEI/comp) renders `N/D` via the Slice 6 `suppressBelowMin5` pattern already used in `engagement.ts`.
- **Tests** — endpoint wiring + min-5 display + role-routing (super_admin → OrgCommandCenter, recruiter → RecruiterDashboard, committee no longer → LeaderDashboard).
- **No new aggregate endpoints** unless a tile has no existing source (lean v1 reuses what's there; richer rollups are a later enrichment).

---

*Next after 1a ships: plan Slice 1b (Org Command Center), then Slice 2 (leader manager-cockpit).*
