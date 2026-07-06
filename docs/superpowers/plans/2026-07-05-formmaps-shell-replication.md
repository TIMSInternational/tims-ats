# FormMaps Shell Replication (Dark Blue Chrome) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace TIMS ATS's dashboard shell chrome (3 sidebar variants, top bar, main-content framing) with a
structurally/visually FormMaps-identical port, using a custom dark-blue chrome color (`#052642`) validated via
live prototype instead of FormMaps' own light canvas.

**Architecture:** A new CSS custom-property token layer in `globals.css` (chrome tokens for sidebar/topbar,
content tokens for the white main panel, kept separate so the panel never changes color). Two new small
shared components (`SidebarCollapseToggle`, `SidebarProfileMenu`) extracted so all 3 existing sidebar files
consume identical toggle/profile-dropdown behavior instead of tripling the same markup. `admin-shell.tsx` and
`navbar/index.tsx` restructured to FormMaps' flex/spacing layout. `lib/nav/manifest.ts` gains optional
sub-item type support (infrastructure only — no manifest populates it in this plan).

**Tech Stack:** Next.js 15 App Router, Tailwind 4 (arbitrary-value classes referencing the new CSS vars),
TypeScript strict, Vitest, `next/font/google` for Poppins.

## Global Constraints

- **Spec is authoritative:** `docs/superpowers/specs/2026-07-05-formmaps-shell-replication-design.md` —
  read the "Decisions made" section (items 1-8) before starting; every task below implements one or more of
  those decisions.
- **Chrome color = `#052642` solid** (sidebar + topbar background), text scale white at 100%/78%/55%/40%
  opacity (primary/secondary/tertiary/light), active-nav-item = solid `#2E9098` (teal) + white text/icon,
  hover = `rgba(255,255,255,.08)`, divider/border = `rgba(255,255,255,.14)`. **Defined exactly once**, in
  Task 1, as CSS custom properties (`--chrome-*`). Every later task references `var(--chrome-*)` via Tailwind
  arbitrary-value syntax (e.g. `bg-[var(--chrome-bg)]`) — **never hardcode `#052642` or the opacity values
  again outside Task 1.**
- **Content-panel tokens** (the white main area) are FormMaps' `colorsLight` values verbatim: bg `#ffffff`,
  border `#e0e0e0`/`#eee`, font `#141414`/`#474747`/`#818181`/`#999`. Also defined once in Task 1 as
  `--content-*`, though no task in this plan actually needs to change existing page content — these exist for
  completeness/future use by the shell's own chrome-adjacent surfaces (e.g. the profile-menu popover, which
  stays light per FormMaps' own popover treatment).
- **Spacing:** sidebar 220px expanded / 52px collapsed (replacing 240px/72px), nav-item row height 28px
  (replacing 40px), radius scale `4px/6px/8px/12px` (`--r-sm/md/lg/xl`).
- **Font:** Poppins for sidebar text only, loaded via `next/font/google` (self-hosted at build time, same
  pattern as the existing Inter loader in `apps/web/app/layout.tsx` — never a runtime Google Fonts `<link>`).
  Inter stays the font everywhere else, unchanged.
- **Breadcrumb stays** in the top bar (confirmed decision), restyled only to the new 40px compact height —
  do not remove it.
- **Out of scope, do not build:** dark/light/system theme picker, AI-chat-in-sidebar, `SidePanel` overlay
  system, any change to `lib/nav/manifest.ts`'s actual section/item *content* (only its *types* change, in
  Task 2).
- **No `any`. No new inline `style={{}}`** — Tailwind arbitrary-value classes only, matching this repo's
  existing convention of literal-hex arbitrary classes (`bg-[#1F114C]`), just now pointing at CSS vars
  (`bg-[var(--chrome-bg)]`) instead of literal hex, so the color lives in one place.
- **No new i18n keys.** The profile-menu dropdown (Task 3) reuses the *existing* `t.nav.security` and
  `t.nav.logout` strings (currently used as `title=` tooltips on icon buttons) as visible menu-item labels —
  it does not need a generic "Settings" entry, since TIMS has no single settings landing page FormMaps'
  dropdown links to (its Settings section is already inline in the main nav for the roles that have one). If
  any task seems to need new copy, stop and flag it rather than inventing a key.
- **Verification model:** this is a presentational/structural change with zero backend/data touch. Per-task
  gate = `pnpm --filter @tims/api exec tsc --noEmit` + (in `apps/web`) `npx tsc --noEmit` + `npx vitest run`
  staying green, plus the manual visual check described in the task. **Do not write a test that merely
  asserts a specific Tailwind class string appears somewhere — that is not meaningful coverage for a color/
  spacing change.** Task 2 (manifest type extension) is the one task with real testable logic and gets a real
  TDD unit test.
- **Task order:** Tasks 1→2→3 must land in order (tokens → types → shared components) before Tasks 4-8
  consume them. Tasks 6, 7, 8 (the three sidebars) are independent of each other once 1-3 are done and can be
  built/reviewed in any order.
- **Each task is one commit**, independently mergeable/revertable (this whole plan is a pure rendering
  change — if anything looks wrong after merge, any single task's commit can be reverted without touching the
  others, since Tasks 4-8 each only edit their own file(s)).

---

## Task 1: Design tokens + Poppins font

**Files:**
- Modify: `apps/web/app/globals.css`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Produces: CSS custom properties `--chrome-bg`, `--chrome-text-primary`, `--chrome-text-secondary`,
  `--chrome-text-tertiary`, `--chrome-text-light`, `--chrome-hover`, `--chrome-border-light`,
  `--chrome-accent-active`, `--chrome-logo-bg`, `--chrome-logo-text`, `--content-bg-panel`,
  `--content-bg-hover`, `--content-border-default`, `--content-border-light`, `--content-font-primary`,
  `--content-font-secondary`, `--content-font-tertiary`, `--content-font-light`, `--r-sm`, `--r-md`, `--r-lg`,
  `--r-xl`, `--sidebar-w-expanded`, `--sidebar-w-collapsed`, `--nav-item-h` — every later task consumes these
  by exact name.
- Produces: a `--font-poppins` CSS variable (same mechanism as the existing `--font-inter`), and a
  `.tims-sidebar` class that sets `font-family` to it — Tasks 6/7/8 apply `className="tims-sidebar ..."` to
  each `<aside>` root.

- [ ] **Step 1: Add the token block to `globals.css`**

Open `apps/web/app/globals.css`. Add this block immediately after the existing `:root { ... }` block (after
line 24, before the `body { ... }` rule):

```css
/* ── Shell chrome tokens (sidebar + top bar) — FormMaps shell replication, dark-blue variant ── */
:root {
  --chrome-bg: #052642;
  --chrome-text-primary: #ffffff;
  --chrome-text-secondary: rgba(255, 255, 255, 0.78);
  --chrome-text-tertiary: rgba(255, 255, 255, 0.55);
  --chrome-text-light: rgba(255, 255, 255, 0.4);
  --chrome-hover: rgba(255, 255, 255, 0.08);
  --chrome-border-light: rgba(255, 255, 255, 0.14);
  --chrome-accent-active: #2e9098;
  --chrome-logo-bg: #ffffff;
  --chrome-logo-text: #052642;

  /* Content-panel tokens — FormMaps colorsLight, verbatim. The white main panel and any
     chrome-adjacent popover (e.g. the profile menu) use these, never --chrome-*. */
  --content-bg-panel: #ffffff;
  --content-bg-hover: rgba(0, 0, 0, 0.04);
  --content-border-default: #e0e0e0;
  --content-border-light: #eee;
  --content-font-primary: #141414;
  --content-font-secondary: #474747;
  --content-font-tertiary: #818181;
  --content-font-light: #999;

  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 8px;
  --r-xl: 12px;
  --sidebar-w-expanded: 220px;
  --sidebar-w-collapsed: 52px;
  --nav-item-h: 28px;
}

.tims-sidebar {
  font-family: var(--font-poppins), 'Poppins', var(--font-inter), 'Inter', system-ui, sans-serif;
}
```

- [ ] **Step 2: Load Poppins in the root layout**

Edit `apps/web/app/layout.tsx`. Change:

```tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
```

to:

```tsx
import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const poppins = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-poppins' });
```

Then change the `<html>` tag's `className` from:

```tsx
<html lang="es" className={inter.variable}>
```

to:

```tsx
<html lang="es" className={`${inter.variable} ${poppins.variable}`}>
```

Weights `500/600/700` match every font-weight actually used across the sidebar files being ported in Tasks
6-8 (`font-medium`/`font-semibold`/`font-bold` — no `400` regular weight is used in any nav label, section
label, or profile text in the source files).

- [ ] **Step 3: Verify types and build**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (this step only adds CSS and a font loader call, no logic changes).

Run: `cd apps/web && npx next build`
Expected: build succeeds; no "failed to load font" or "unknown variable" errors in the output.

- [ ] **Step 4: Manual visual check**

Run `cd apps/web && pnpm dev`, open any admin page, open browser devtools → Elements → select `<html>` →
confirm computed styles show a `--font-poppins` custom property with a real font stack value (not `unset`).
This confirms the font actually loaded — nothing in the UI will visibly use it yet until Task 6-8 apply
`.tims-sidebar`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/globals.css apps/web/app/layout.tsx
git commit -m "feat(shell): add dark-blue chrome design tokens and Poppins font"
```

---

## Task 2: Extend nav manifest types for optional sub-items

**Files:**
- Modify: `apps/web/lib/nav/manifest.ts`
- Test: `apps/web/lib/nav/manifest.test.ts` (create if it doesn't already exist — check first with
  `find apps/web/lib/nav -name '*.test.ts'`; if a test file already exists for this module, add to it instead
  of creating a duplicate)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `NavItem` type gains optional `sub?: readonly NavSubItem[]`; new exported type `NavSubItem = {
  readonly href: string; readonly labelKey: string; readonly icon: string }`; `computeVisibleSections` must
  prune a parent item's `sub` array the same way it prunes top-level items (a sub-item with a `module` the
  user can't read should be filtered out — but note `NavSubItem` as defined has no `module` field, matching
  the plan's "infrastructure only, no real usage yet" scope: sub-items inherit their parent's visibility, they
  are not independently permission-gated. This is intentional — nothing in `MANIFESTS` populates `sub` today,
  so there is no real permission-pruning case to handle yet; document this in a comment rather than building
  unused permission logic for sub-items).

This task's only real behavior to test: **adding `sub` to a `NavItem` must not break `computeVisibleSections`
or `isNavItemActive` for existing (sub-less) items** — a pure non-regression guarantee, since nothing consumes
`sub` yet.

- [ ] **Step 1: Write the failing test**

First check for an existing test file:

Run: `find apps/web/lib/nav -name '*.test.ts'`

If none exists, create `apps/web/lib/nav/manifest.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeVisibleSections, isNavItemActive, type NavSection } from './manifest';

describe('manifest sub-item type support (non-regression)', () => {
  const sectionWithSub: NavSection = {
    labelKey: 'sidebar.recruitment',
    items: [
      {
        href: '/recruitment/pipeline',
        labelKey: 'sidebar.pipeline',
        icon: 'kanban',
        module: 'pipeline',
        sub: [
          { href: '/recruitment/pipeline/kanban', labelKey: 'sidebar.pipelineKanban', icon: 'kanban' },
          { href: '/recruitment/pipeline/list', labelKey: 'sidebar.pipelineList', icon: 'clipboard' },
        ],
      },
    ],
  };

  it('keeps an item with sub-items when the user can read its module', () => {
    const visible = computeVisibleSections([sectionWithSub], () => true, false);
    expect(visible).toHaveLength(1);
    expect(visible[0].items[0].sub).toHaveLength(2);
  });

  it('prunes an item with sub-items when the user cannot read its module (same as a sub-less item)', () => {
    const visible = computeVisibleSections([sectionWithSub], () => false, false);
    expect(visible).toHaveLength(0);
  });

  it('isNavItemActive matches a sub-item href the same way it matches a top-level href', () => {
    expect(isNavItemActive('/recruitment/pipeline/kanban', '/recruitment/pipeline/kanban')).toBe(true);
    expect(isNavItemActive('/recruitment/pipeline/kanban/123', '/recruitment/pipeline/kanban')).toBe(true);
    expect(isNavItemActive('/recruitment/vacancies', '/recruitment/pipeline/kanban')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run lib/nav/manifest.test.ts`
Expected: FAIL — `NavItem` has no `sub` property, so the test file itself fails to type-check (or `sub` is
`undefined` and `.sub` assertions fail).

- [ ] **Step 3: Add the type**

In `apps/web/lib/nav/manifest.ts`, change:

```typescript
export type NavItem = { readonly href: string; readonly labelKey: string; readonly icon: string; readonly module: Module | null };
export type NavSection = { readonly labelKey: string | null; readonly items: readonly NavItem[] };
```

to:

```typescript
export type NavSubItem = { readonly href: string; readonly labelKey: string; readonly icon: string };
// `sub` is infrastructure only as of this change — no entry in MANIFESTS below populates it yet, and
// sub-items inherit their parent's module-gate rather than being independently permission-checked
// (there is no real case requiring per-sub-item permissions today; add one only when a manifest
// actually needs it).
export type NavItem = { readonly href: string; readonly labelKey: string; readonly icon: string; readonly module: Module | null; readonly sub?: readonly NavSubItem[] };
export type NavSection = { readonly labelKey: string | null; readonly items: readonly NavItem[] };
```

No change is needed to `computeVisibleSections` — since `sub` is optional and the function's existing spread
(`{ ...s, items: s.items.filter(...) }`) already preserves every other field on each item unchanged (including
a new optional `sub`), the pruning behavior for the parent item (keep/drop based on its own `module`) already
extends correctly with zero code changes. This is exactly what Step 1's tests confirm.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run lib/nav/manifest.test.ts`
Expected: PASS, 3/3 tests.

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/nav/manifest.ts apps/web/lib/nav/manifest.test.ts
git commit -m "feat(nav): add optional sub-item type support to NavItem (infra only)"
```

---

## Task 3: Shared sidebar sub-components (collapse toggle + profile menu)

**Files:**
- Create: `apps/web/app/(admin)/sidebar-collapse-toggle.tsx`
- Create: `apps/web/app/(admin)/sidebar-profile-menu.tsx`

**Interfaces:**
- Consumes: `var(--chrome-*)` tokens from Task 1.
- Produces:
  - `SidebarCollapseToggle({ expanded, onToggle, collapseLabel, expandLabel }: { expanded: boolean; onToggle:
    () => void; collapseLabel: string; expandLabel: string })` — a small icon button meant to sit top-right of
    each sidebar's logo bar (replacing the current bottom-row toggle button in all 3 sidebars). Takes
    `collapseLabel`/`expandLabel` as props (rather than hardcoding the `aria-label` strings) so the i18n
    no-hardcoded-strings gate passes; Tasks 6-8 pass `t.nav.collapse`/`t.nav.expand`.
  - `SidebarProfileMenu({ userInitials, displayName, roleLabel, avatar, expanded, securityLabel, logoutLabel
    }: { userInitials: string; displayName: string; roleLabel: string; avatar?: string | null; expanded:
    boolean; securityLabel: string; logoutLabel: string })` — the bottom-of-sidebar profile button that opens
    an upward dropdown with Security (→ `/mfa`) and Sign out. Tasks 6-8 pass `t.nav.security`/`t.nav.logout`
    as `securityLabel`/`logoutLabel` — this component takes no `useI18n()` dependency itself, keeping it a
    pure presentational unit each sidebar wires up with its own translated strings (all 3 sidebar files
    already call `useI18n()` for other labels, so this avoids a second unnecessary i18n context read here and
    keeps the component testable without an i18n provider).

- [ ] **Step 1: Create `sidebar-collapse-toggle.tsx`**

```tsx
'use client';

export function SidebarCollapseToggle({
  expanded,
  onToggle,
  collapseLabel,
  expandLabel,
}: {
  expanded: boolean;
  onToggle: () => void;
  collapseLabel: string;
  expandLabel: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-center w-[26px] h-[26px] rounded-[var(--r-sm)] text-[var(--chrome-text-tertiary)] hover:bg-[var(--chrome-hover)] transition-colors shrink-0"
      aria-label={expanded ? collapseLabel : expandLabel}
    >
      {expanded ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M9 4v16M15 4v16" />
          <path d="M15 12H4M8 8l-4 4 4 4" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M9 4v16M15 4v16" />
          <path d="M9 12h11M15 8l4 4-4 4" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Create `sidebar-profile-menu.tsx`**

```tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';

// Mirrors the useClickOutside hook already used in apps/web/app/(admin)/navbar/index.tsx —
// a document-level mousedown listener, not onBlur (onBlur only fires when focus moves to
// another focusable element; clicking a plain, non-focusable area of the page would leave
// the menu stuck open).
function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

export function SidebarProfileMenu({
  userInitials,
  displayName,
  roleLabel,
  avatar,
  expanded,
  securityLabel,
  logoutLabel,
}: {
  userInitials: string;
  displayName: string;
  roleLabel: string;
  avatar?: string | null;
  expanded: boolean;
  securityLabel: string;
  logoutLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useClickOutside(wrapRef, () => setOpen(false));

  const handleLogout = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2.5 w-full rounded-[var(--r-lg)] text-[var(--chrome-text-primary)] hover:bg-[var(--chrome-hover)] transition-colors ${
          expanded ? 'px-2 py-2' : 'justify-center px-1 py-1.5'
        }`}
      >
        {avatar ? (
          <img src={avatar} alt="" className="w-7 h-7 rounded-[var(--r-md)] shrink-0 object-cover" />
        ) : (
          <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
            {userInitials}
          </div>
        )}
        {expanded && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <p className="text-[12px] font-semibold truncate">{displayName}</p>
              <p className="text-[10px] text-[var(--chrome-text-tertiary)] truncate">{roleLabel}</p>
            </div>
            <svg className="w-3 h-3 text-[var(--chrome-text-light)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </>
        )}
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+4px)] left-2 w-[190px] bg-[var(--content-bg-panel)] border border-[var(--content-border-light)] rounded-[var(--r-lg)] shadow-[2px_4px_16px_rgba(0,0,0,0.14),0_2px_4px_rgba(0,0,0,0.06)] p-1 z-50">
          <Link
            href="/mfa"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 h-[30px] px-2 rounded-[var(--r-sm)] text-[12px] text-[var(--content-font-secondary)] hover:bg-[var(--content-bg-hover)] transition-colors"
          >
            <svg className="w-3.5 h-3.5 text-[var(--content-font-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
            </svg>
            {securityLabel}
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 w-full h-[30px] px-2 rounded-[var(--r-sm)] text-[12px] text-[var(--content-font-secondary)] hover:bg-[var(--content-bg-hover)] transition-colors text-left"
          >
            <svg className="w-3.5 h-3.5 text-[var(--content-font-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
              <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
            {logoutLabel}
          </button>
        </div>
      )}
    </div>
  );
}
```

The file's final contents are exactly the two blocks above concatenated (imports + `useClickOutside` +
`SidebarProfileMenu`) — nothing else.

- [ ] **Step 3: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual visual check**

These two components have no consumer yet (Tasks 6-8 wire them in) — skip a standalone visual check here;
Task 6's manual check step covers both components together in their real usage.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/sidebar-collapse-toggle.tsx" "apps/web/app/(admin)/sidebar-profile-menu.tsx"
git commit -m "feat(shell): add shared SidebarCollapseToggle and SidebarProfileMenu components"
```

---

## Task 4: Restructure AdminShell to the FormMaps flex layout

**Files:**
- Modify: `apps/web/app/(admin)/admin-shell.tsx`

**Interfaces:**
- Consumes: `var(--content-bg-panel)`, `var(--content-border-default)`, `var(--r-lg)` from Task 1.
- Produces: no change to `AdminShell`'s props or exports — this task only changes the JSX/className structure
  inside the function body. `Navbar`, `SidebarComponent`, `ImpersonationBanner`, `SupportChat`,
  `RouteAccessGuard`, `TRPCProvider`, `PermissionsProvider`, `I18nProvider` are all still rendered, unchanged.

The current structure (`apps/web/app/(admin)/admin-shell.tsx:64-101`) renders the sidebar and a flush
`bg-[#F6F6F6]` `<main>` with no border/radius. FormMaps wraps its main content in a bordered, rounded white
panel with padding around the whole right-hand column. Port that framing.

- [ ] **Step 1: Replace the shell JSX**

In `apps/web/app/(admin)/admin-shell.tsx`, replace the `return (...)` block (lines 60-107) with:

```tsx
  return (
    <I18nProvider>
    <TRPCProvider>
      <PermissionsProvider isPlatformOwner={isPlatformOwner}>
      <div className="flex h-screen overflow-hidden bg-[var(--chrome-bg)]">
        {/* Mobile backdrop */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}
        {/* Sidebar: static on md+, off-canvas drawer on mobile */}
        <div
          className={`fixed inset-y-0 left-0 z-40 transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
          }`}
        >
          <SidebarComponent
            userInitials={userInitials}
            displayName={displayName}
            expanded={expanded}
            onToggle={handleToggle}
            ready={mounted}
            avatar={avatar}
          />
        </div>
        <div className="flex flex-col flex-1 min-w-0 pr-3 pb-3 min-h-0">
          <ImpersonationBanner />
          <Navbar
            isPlatformOwner={isPlatformOwner}
            onHelpClick={() => setChatOpen(!chatOpen)}
            onMenuClick={() => setMobileOpen(true)}
          />
          <main className="flex-1 min-h-0 flex flex-col bg-[var(--content-bg-panel)] border border-[var(--content-border-default)] rounded-[var(--r-lg)] overflow-hidden">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <RouteAccessGuard>
              {children}
              </RouteAccessGuard>
            </div>
          </main>
        </div>
      </div>
      <SupportChat open={chatOpen} onClose={() => setChatOpen(false)} />
      </PermissionsProvider>
    </TRPCProvider>
    </I18nProvider>
  );
```

The only changes from the current file: (1) outer wrapper background `bg-[var(--chrome-bg)]` (was unset/white)
— this matches the sidebar's own background so the whole canvas outside the white content panel reads as one
continuous dark-blue chrome area, which the sidebar and top bar visually sit on; (2) the right-hand column
gets `pr-3 pb-3` so the bordered main panel doesn't touch the viewport edge, matching FormMaps'
`paddingRight/paddingBottom: 12`; (3) `<main>` gains the bordered/rounded/white treatment and a nested scroll
container, replacing the flush `bg-[#F6F6F6] overflow-y-auto` single div. Nothing else in the file (the
function signature, `useState`/`useEffect` hooks, `handleToggle`, `pickSidebarVariant` resolution) changes.

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual visual check**

Run `cd apps/web && pnpm dev`, log in, confirm: the sidebar and top bar sit on the same dark-blue chrome
background as the sidebar itself (`var(--chrome-bg)`), the page content renders inside a white bordered/rounded
panel with a visible gap from the viewport's right and bottom edges, and scrolling long page content scrolls
only inside that panel (the sidebar and top bar stay fixed). Confirm the mobile drawer (resize below `md`)
still opens/closes correctly — this logic is untouched but must not have regressed visually.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(admin)/admin-shell.tsx"
git commit -m "feat(shell): wrap main content in FormMaps-style bordered panel with outer canvas"
```

---

## Task 5: Restyle the top bar (compact height, breadcrumb kept)

**Files:**
- Modify: `apps/web/app/(admin)/navbar/index.tsx`

**Interfaces:**
- Consumes: `var(--chrome-*)` tokens from Task 1.
- Produces: no prop/export changes to `Navbar` — same signature, same children (`SearchCommand`,
  `NotificationDropdown`), only the container height/padding/colors and the language-dropdown popover restyle.

Current bar is `h-[56px] bg-white border-b border-[#EDEDED]` with dark-navy-on-white text. Port FormMaps'
compact `min-height: 40px` bar sitting transparently on the outer canvas (no white background/border of its
own — it now sits on the `var(--chrome-bg)` dark-blue canvas from Task 4, with light-on-dark chrome text) and
keep the breadcrumb per the confirmed decision.

- [ ] **Step 1: Replace the header element and breadcrumb styling**

In `apps/web/app/(admin)/navbar/index.tsx`, change:

```tsx
    <header className="flex items-center justify-between px-4 md:px-6 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
```

to:

```tsx
    <header className="flex items-center justify-between px-2 md:px-3 min-h-[40px] shrink-0">
```

Change the breadcrumb spans:

```tsx
        {crumb.parent && (
          <>
            <span className="hidden md:inline text-[13px] text-[#8B8B8B]">{crumb.parent}</span>
            <svg className="hidden md:block w-3.5 h-3.5 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </>
        )}
        <span className="text-[13px] font-medium text-[#1F114C] truncate">{crumb.label}</span>
```

to:

```tsx
        {crumb.parent && (
          <>
            <span className="hidden md:inline text-[12px] text-[var(--chrome-text-tertiary)]">{crumb.parent}</span>
            <svg className="hidden md:block w-3 h-3 text-[var(--chrome-text-light)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </>
        )}
        <span className="text-[12px] font-semibold text-[var(--chrome-text-primary)] truncate">{crumb.label}</span>
```

- [ ] **Step 2: Restyle the mobile hamburger, help button, and their hover states**

Change the mobile hamburger button:

```tsx
        <button
          onClick={onMenuClick}
          className="md:hidden -ml-1 mr-1 w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#F6F6F6] transition-colors shrink-0"
          aria-label="Menu"
        >
          <svg className="w-5 h-5 text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" /></svg>
        </button>
```

to:

```tsx
        <button
          onClick={onMenuClick}
          className="md:hidden -ml-1 mr-1 w-8 h-8 rounded-[var(--r-md)] flex items-center justify-center hover:bg-[var(--chrome-hover)] transition-colors shrink-0"
          aria-label="Menu"
        >
          <svg className="w-4.5 h-4.5 text-[var(--chrome-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" /></svg>
        </button>
```

Change the help button:

```tsx
        <button
          onClick={onHelpClick}
          className="w-9 h-9 rounded-lg hidden md:flex items-center justify-center hover:bg-[#F6F6F6] transition-colors"
          title={t.nav.helpCenter}
        >
          <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
```

to:

```tsx
        <button
          onClick={onHelpClick}
          className="w-8 h-8 rounded-[var(--r-md)] hidden md:flex items-center justify-center hover:bg-[var(--chrome-hover)] transition-colors"
          title={t.nav.helpCenter}
        >
          <svg className="w-[16px] h-[16px] text-[var(--chrome-text-tertiary)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
```

- [ ] **Step 3: Restyle the language switcher button and its popover**

Change:

```tsx
          <button
            onClick={() => setLangOpen(!langOpen)}
            className={`h-8 px-2.5 rounded-lg border border-[#EDEDED] flex items-center gap-1.5 transition-colors ${
              langOpen ? 'bg-[#FAFAFA] border-[#ccc]' : 'hover:bg-[#FAFAFA]'
            }`}
          >
            <span className="text-[12px] text-[#585858] font-medium">{locale}</span>
            <svg className={`w-3 h-3 text-[#8B8B8B] transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
```

to:

```tsx
          <button
            onClick={() => setLangOpen(!langOpen)}
            className={`h-7 px-2 rounded-[var(--r-md)] flex items-center gap-1.5 transition-colors ${
              langOpen ? 'bg-[var(--chrome-hover)]' : 'hover:bg-[var(--chrome-hover)]'
            }`}
          >
            <span className="text-[12px] text-[var(--chrome-text-secondary)] font-medium">{locale}</span>
            <svg className={`w-3 h-3 text-[var(--chrome-text-tertiary)] transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
```

Leave the popover dropdown itself (`absolute right-0 top-full ... bg-white ...`) unchanged — it's a
chrome-adjacent popover like the profile menu, and per Global Constraints it correctly stays on
`--content-*` light tokens (it already hardcodes `bg-white`/`text-[#333]`, which visually matches
`--content-bg-panel`/`--content-font-primary` — no change needed since the values are the same).

- [ ] **Step 4: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual visual check**

With the dev server running, confirm: top bar is visibly shorter (40px vs the old 56px), sits transparently on
the grey canvas (no white background/border strip of its own), breadcrumb text is light-colored and legible
against the grey canvas, search/notification/help icons are still clickable and visually consistent, language
switcher popover still opens correctly on click.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(admin)/navbar/index.tsx"
git commit -m "feat(shell): restyle top bar to compact 40px FormMaps density, keep breadcrumb"
```

---

## Task 6: Restyle `sidebar.tsx` (7 org roles)

**Files:**
- Modify: `apps/web/app/(admin)/sidebar.tsx`

**Interfaces:**
- Consumes: `SidebarCollapseToggle`, `SidebarProfileMenu` (Task 3); `var(--chrome-*)`/`var(--nav-item-h)`/
  `var(--sidebar-w-expanded)`/`var(--sidebar-w-collapsed)` (Task 1); `NavItem`/`NavSection` types (Task 2, no
  behavior change needed here — this file doesn't populate `sub` on any item).
- Produces: no prop/export changes to `Sidebar` — same signature (`userInitials, displayName, expanded,
  onToggle, ready, avatar`), consumed identically by `admin-shell.tsx` (untouched by this task).

- [ ] **Step 1: Replace the full file**

Replace the entire contents of `apps/web/app/(admin)/sidebar.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarProfileMenu } from './sidebar-profile-menu';

export function Icon({ name, className }: { name: string; className: string }) {
  const c = className;
  switch (name) {
    case 'grid':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'briefcase':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>;
    case 'kanban':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>;
    case 'user':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>;
    case 'clipboard':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>;
    case 'video':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>;
    case 'users':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>;
    case 'chart':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>;
    case 'rocket':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84"/></svg>;
    case 'target':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
    case 'book':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>;
    case 'ninebox':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>;
    case 'succession':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>;
    case 'team':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 21a8 8 0 00-16 0"/><circle cx="10" cy="8" r="5"/><path d="M23 21a6 6 0 00-6-6"/><circle cx="20" cy="8" r="3"/></svg>;
    case 'heart':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>;
    case 'dei':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m-8-9H3m18 0h-1M5.6 5.6l.7.7m12.4 12.4l-.7-.7M5.6 18.4l.7-.7m12.4-12.4l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>;
    case 'dollar':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
    case 'monitor':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"/><path d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"/></svg>;
    case 'settings':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>;
    default:
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
  }
}

export function Sidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: { userInitials: string; displayName: string; expanded: boolean; onToggle: () => void; ready?: boolean; avatar?: string | null }) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);

  return (
    <aside
      className={`tims-sidebar flex flex-col h-full bg-[var(--chrome-bg)] shrink-0 overflow-hidden ${
        expanded ? 'w-[var(--sidebar-w-expanded)]' : 'w-[var(--sidebar-w-collapsed)]'
      } ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      }`}
    >
      {/* Logo bar */}
      <div className={`flex items-center justify-between shrink-0 ${expanded ? 'px-3.5 py-3' : 'px-1.5 py-3 justify-center'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-7 brightness-0 invert" />
          ) : (
            <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center">
              <span className="text-white text-[12px] font-bold">T</span>
            </div>
          )}
        </Link>
        {expanded && <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />}
      </div>
      {!expanded && (
        <div className="flex justify-center pb-2">
          <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-1 px-2 flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {VISIBLE_SECTIONS.map((section, si) => (
          <div key={si}>
            {expanded && section.labelKey && (
              <p className="text-[10px] uppercase tracking-wider text-[var(--chrome-text-light)] font-semibold px-2 pb-1.5 whitespace-nowrap">
                {resolveLabel(t, section.labelKey)}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? resolveLabel(t, item.labelKey) : undefined}
                    className={`group flex items-center gap-2 h-[var(--nav-item-h)] rounded-[var(--r-sm)] transition-colors ${
                      expanded ? 'px-2' : 'justify-center'
                    } ${
                      isActive
                        ? 'bg-[var(--chrome-accent-active)] text-white'
                        : 'text-[var(--chrome-text-secondary)] hover:bg-[var(--chrome-hover)]'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[var(--chrome-text-tertiary)] group-hover:text-[var(--chrome-text-secondary)]'}`}
                    />
                    {expanded && (
                      <span className="text-[13px] font-medium whitespace-nowrap flex-1 overflow-hidden text-ellipsis">
                        {resolveLabel(t, item.labelKey)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: profile menu */}
      <div className={`border-t border-[var(--chrome-border-light)] shrink-0 ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={roleLabel ?? t.nav.admin}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
```

Notes on what changed from the current file: the `logout`/`security` icon-button row and the bottom
collapse-toggle button are both replaced by `SidebarProfileMenu` and `SidebarCollapseToggle` (Task 3). The
collapse toggle moves to the top-right of the logo bar when expanded, and just below the logo when collapsed
(there is no room beside a centered collapsed logo — this matches the prototype's collapsed-state placement).
Width switches from fixed Tailwind classes (`w-[240px]`/`w-[72px]`) to a ternary between
`w-[var(--sidebar-w-expanded)]` and `w-[var(--sidebar-w-collapsed)]` — Tailwind's arbitrary-value syntax
accepts a CSS variable directly, so no inline `style={{}}` is needed at all; the width still reads from the
same two CSS variables Task 1 defines, just referenced from within the className string like every other
token in this file.

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

Run: `cd apps/web && npx vitest run`
Expected: all existing tests stay green (no test directly renders `Sidebar`, but this confirms no import-graph
breakage).

- [ ] **Step 3: Manual visual check**

Log in as a `recruiter` or `hr_admin` seeded user. Confirm: sidebar is dark blue, 220px wide expanded / 52px
collapsed, nav rows are visibly shorter (28px) than before, the active route's nav item has a solid teal
background with white text, collapse toggle sits top-right of the logo when expanded, clicking the bottom
profile button opens an upward white dropdown with "Seguridad"/"Cerrar sesión" (or English equivalents) that
navigates/logs out correctly, and the dropdown closes on clicking outside or selecting an item.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(admin)/sidebar.tsx"
git commit -m "feat(shell): restyle Sidebar to dark-blue FormMaps chrome"
```

---

## Task 7: Restyle `platform-sidebar.tsx`

**Files:**
- Modify: `apps/web/app/(admin)/platform-sidebar.tsx`

**Interfaces:**
- Consumes: `SidebarCollapseToggle`, `SidebarProfileMenu` (Task 3); same chrome tokens as Task 6.
- Produces: no prop/export changes to `PlatformSidebar`.

This file's own `Icon` function and `useNavSections()` hook (platform-specific nav content) are unchanged —
only the visual shell around them changes, mirroring exactly what Task 6 did to `sidebar.tsx`.

- [ ] **Step 1: Apply the same restructure**

Keep the file's existing `useNavSections()` hook and `Icon` function (lines 8-72) completely unchanged. Replace
the `PlatformSidebar` function body (from `export function PlatformSidebar` through its closing `}`, currently
lines 74-216) with:

```tsx
export function PlatformSidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: {
  userInitials: string;
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  ready?: boolean;
  avatar?: string | null;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const NAV_SECTIONS = useNavSections();

  return (
    <aside
      className={`tims-sidebar flex flex-col h-full bg-[var(--chrome-bg)] shrink-0 overflow-hidden ${
        expanded ? 'w-[var(--sidebar-w-expanded)]' : 'w-[var(--sidebar-w-collapsed)]'
      } ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      }`}
    >
      {/* Logo bar */}
      <div className={`flex items-center justify-between shrink-0 ${expanded ? 'px-3.5 py-3' : 'px-1.5 py-3 justify-center'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-7 brightness-0 invert" />
          ) : (
            <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center">
              <span className="text-white text-[12px] font-bold">T</span>
            </div>
          )}
        </Link>
        {expanded && <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />}
      </div>
      {!expanded && (
        <div className="flex justify-center pb-2">
          <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-1 px-2 flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {expanded && section.label && (
              <p className="text-[10px] uppercase tracking-wider text-[var(--chrome-text-light)] font-semibold px-2 pb-1.5 whitespace-nowrap">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? item.label : undefined}
                    className={`group flex items-center gap-2 h-[var(--nav-item-h)] rounded-[var(--r-sm)] transition-colors ${
                      expanded ? 'px-2' : 'justify-center'
                    } ${
                      isActive
                        ? 'bg-[var(--chrome-accent-active)] text-white'
                        : 'text-[var(--chrome-text-secondary)] hover:bg-[var(--chrome-hover)]'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[var(--chrome-text-tertiary)] group-hover:text-[var(--chrome-text-secondary)]'}`}
                    />
                    {expanded && (
                      <span className="text-[13px] font-medium whitespace-nowrap flex-1 overflow-hidden text-ellipsis">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: profile menu */}
      <div className={`border-t border-[var(--chrome-border-light)] shrink-0 ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={t.nav.admin}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
```

Update the file's imports at the top: `SidebarCollapseToggle` and `SidebarProfileMenu` are now used and must be
imported; `useRouter` and `createSupabaseBrowserClient` are no longer used directly in this file (that logic
moved into `SidebarProfileMenu`) and their imports must be removed to avoid an unused-import lint/tsc warning.
The file's final import block:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarProfileMenu } from './sidebar-profile-menu';
```

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (in particular, no unused-import errors).

- [ ] **Step 3: Manual visual check**

Log in as the platform-owner seeded user (`federico@nexadev.ai`). Confirm the same visual/interaction checks
as Task 6's Step 3, applied to the platform sidebar's own nav items (Organizaciones, Suscripciones, Facturas,
etc.).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(admin)/platform-sidebar.tsx"
git commit -m "feat(shell): restyle PlatformSidebar to dark-blue FormMaps chrome"
```

---

## Task 8: Restyle `participant-sidebar.tsx`

**Files:**
- Modify: `apps/web/app/(admin)/participant-sidebar.tsx`

**Interfaces:**
- Consumes: `SidebarCollapseToggle`, `SidebarProfileMenu` (Task 3); same chrome tokens as Tasks 6-7.
- Produces: no prop/export changes to `ParticipantSidebar`.

**This is the one sidebar making the biggest visual jump** — it currently uses a light white theme (`bg-white
border-r border-[#ECECEC]`, navy-on-white active state) instead of the other two sidebars' dark theme. Per the
approved spec (decision #7: "all 3 TIMS sidebar variants get the treatment" with the same chrome color), it
converts to the same dark-blue chrome as `sidebar.tsx`/`platform-sidebar.tsx`, unifying all three shells.

- [ ] **Step 1: Apply the same restructure**

Replace the entire contents of `apps/web/app/(admin)/participant-sidebar.tsx` with:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { Icon } from './sidebar';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarProfileMenu } from './sidebar-profile-menu';

// ParticipantSidebar = the manifest-driven chrome for participant-shell roles (committee, employee).
// It mirrors Sidebar's rendering loop exactly (same manifest, same computeVisibleSections pruning) and,
// as of the FormMaps shell replication, now shares the identical dark-blue chrome — TIMS's 3 sidebar
// variants read as one consistent shell rather than 3 differently-themed surfaces.
export function ParticipantSidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: {
  userInitials: string;
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  ready?: boolean;
  avatar?: string | null;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);

  return (
    <aside
      className={`tims-sidebar flex flex-col h-full bg-[var(--chrome-bg)] shrink-0 overflow-hidden ${
        expanded ? 'w-[var(--sidebar-w-expanded)]' : 'w-[var(--sidebar-w-collapsed)]'
      } ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      }`}
    >
      {/* Logo bar */}
      <div className={`flex items-center justify-between shrink-0 ${expanded ? 'px-3.5 py-3' : 'px-1.5 py-3 justify-center'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-7 brightness-0 invert" />
          ) : (
            <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center">
              <span className="text-white text-[12px] font-bold">T</span>
            </div>
          )}
        </Link>
        {expanded && <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />}
      </div>
      {!expanded && (
        <div className="flex justify-center pb-2">
          <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-1 px-2 flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {VISIBLE_SECTIONS.map((section, si) => (
          <div key={si}>
            {expanded && section.labelKey && (
              <p className="text-[10px] uppercase tracking-wider text-[var(--chrome-text-light)] font-semibold px-2 pb-1.5 whitespace-nowrap">
                {resolveLabel(t, section.labelKey)}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? resolveLabel(t, item.labelKey) : undefined}
                    className={`group flex items-center gap-2 h-[var(--nav-item-h)] rounded-[var(--r-sm)] transition-colors ${
                      expanded ? 'px-2' : 'justify-center'
                    } ${
                      isActive
                        ? 'bg-[var(--chrome-accent-active)] text-white'
                        : 'text-[var(--chrome-text-secondary)] hover:bg-[var(--chrome-hover)]'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[var(--chrome-text-tertiary)] group-hover:text-[var(--chrome-text-secondary)]'}`}
                    />
                    {expanded && (
                      <span className="text-[13px] font-medium whitespace-nowrap flex-1 overflow-hidden text-ellipsis">
                        {resolveLabel(t, item.labelKey)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: profile menu */}
      <div className={`border-t border-[var(--chrome-border-light)] shrink-0 ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={roleLabel ?? t.nav.admin}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
```

Note `useRouter` and `createSupabaseBrowserClient` are dropped from this file's imports for the same reason as
Task 7 (logout logic now lives in `SidebarProfileMenu`).

- [ ] **Step 2: Verify types**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual visual check**

Log in as a seeded `committee` or `employee` user. Confirm the sidebar now matches the dark-blue chrome (a
visible change from its previous light-white theme), the "Mis Tareas"/"Mi Hogar" manifest sections render
correctly, and the profile menu behaves identically to Tasks 6/7.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/app/(admin)/participant-sidebar.tsx"
git commit -m "feat(shell): restyle ParticipantSidebar to dark-blue FormMaps chrome (was light theme)"
```

---

## Task 9: Full role-matrix verification + whole-branch review

**Files:** none (verification only).

- [ ] **Step 1: Full local gate**

```bash
cd packages/db && npx prisma generate --schema=prisma/schema
pnpm --filter @tims/api exec tsc --noEmit
cd apps/web && npx tsc --noEmit
cd ../.. && npx vitest run
cd apps/web && npx next build
```

Expected: all green, matching every prior PR this session (api tsc 0 errors, web tsc 0 errors, vitest all
passing including the new `manifest.test.ts` from Task 2, `next build` succeeds for every route).

- [ ] **Step 2: Role-matrix manual/Playwright check**

Log in as one seeded user per manifest to confirm no shell regression for any role:
`super_admin`, `hr_admin`, `hrbp`, `recruiter`, `leader` (all render via `Sidebar`), `committee`, `employee`
(render via `ParticipantSidebar`), and the platform-owner account (`PlatformSidebar`). For each: sidebar
renders at the correct width/collapse state, active-route highlighting works, collapse/expand persists across
a page reload (via the existing `tims-sidebar-expanded` `localStorage` key in `admin-shell.tsx`, untouched by
this plan), profile menu opens/closes and its Security/Sign-out actions work, top bar breadcrumb resolves
correctly for at least 2 distinct routes per role, and no page's own content assumes the old sidebar width or
top-bar height in a way that now looks broken (spot-check the recruitment pipeline kanban board and any page
with a fixed-width layout calculation, since those are the ones most likely to have hardcoded assumptions
about the old 240px/72px sidebar).

- [ ] **Step 3: Dispatch whole-branch review + Codex adversarial review**

Per this repo's standing process (`.claude/rules/verification.md`), dispatch a whole-branch code review
(most capable model) using the review-package script covering the full branch diff, then dispatch
`codex:codex-rescue` for an adversarial pass with full file visibility. Address any Critical/Important
findings before merge, per the same loop used for PR #112 (M4pt2 ErrorState wiring) earlier this session.

- [ ] **Step 4: Ship**

Push the branch, open a PR (title: "feat(shell): replicate FormMaps dashboard shell with dark-blue chrome"),
wait for real CI (not the 3-4s billing-trap pattern) to go green, squash-merge to `main`, verify the Vercel
prod deploy, and run the same prod smoke check used for PR #112 (`/` → 307, `/login` → 200, an authenticated
tRPC route → non-500).

---

## Plan self-review notes

- **Spec coverage:** all 8 numbered decisions in the design spec map to at least one task above (tokens →
  Task 1; sub-nav infra → Task 2; profile-dropdown consolidation → Task 3; bordered panel → Task 4;
  breadcrumb-kept restyle → Task 5; all 3 sidebars → Tasks 6-8; role-matrix verification → Task 9).
- **Type consistency checked:** `SidebarProfileMenu`'s prop names (`userInitials, displayName, roleLabel,
  avatar, expanded, securityLabel, logoutLabel`) are identical across all 3 call sites in Tasks 6/7/8.
  `SidebarCollapseToggle`'s `{ expanded, onToggle, collapseLabel, expandLabel }` likewise matches its 6 call
  sites (2 per sidebar file × 3 files), each passing `t.nav.collapse`/`t.nav.expand`. CSS variable names
  introduced in Task 1 are referenced by the exact same string in every
  consuming task — cross-checked `--chrome-bg`, `--chrome-accent-active`, `--nav-item-h`,
  `--sidebar-w-expanded`, `--sidebar-w-collapsed` against Tasks 4-8.
- **No placeholders:** every task has complete, pasteable code — no "similar to Task N" references (Tasks 7
  and 8 repeat Task 6's structure in full rather than pointing back at it, since a subagent may work these
  tasks in any order or out of context of one another).
