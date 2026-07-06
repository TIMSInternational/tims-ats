# FormMaps Shell Replication — Design Spec

> **For agentic workers:** this spec is the input to `superpowers:writing-plans` →
> `superpowers:subagent-driven-development`. Do not start implementation from this file alone — write the
> plan first.

**Goal:** Replace TIMS ATS's current dashboard shell chrome (sidebar, top bar, main-content framing) with a
structurally and visually identical port of the FormMaps platform's dashboard shell (`AppShell.tsx` +
`PageTopBar.tsx` + `StudentSidebar.tsx`), using FormMaps' exact design tokens (spacing, radius, typography,
interaction patterns), with one deliberate customization: a dark blue chrome color (`#052642`) validated via
live prototype iteration, replacing FormMaps' own light/transparent sidebar canvas.

**Source of truth for "identical":** `~/formmaps-platform/frontend/src/components/layout/AppShell.tsx`,
`PageTopBar.tsx`, `~/formmaps-platform/frontend/src/app/dashboard/_components/StudentSidebar.tsx`, and the
token files `~/formmaps-platform/frontend/src/styles/tokens/{colors,spacing,typography}.ts`.

**Validated via:** an interactive HTML/CSS/JS prototype (Artifact) built from FormMaps' literal token values
applied to TIMS's real recruitment nav content, iterated live with Federico across several color rounds
(light/transparent → `#065292` → `#043966` → **`#052642` final**).

## Decisions made during brainstorming (with defaults applied where Federico didn't respond — flagged for override on spec review)

1. **Scope of "identical" = visual + structural (colors, spacing, typography, interaction patterns), not a
   literal file copy.** FormMaps' shell depends on infrastructure TIMS doesn't have and doesn't need for this
   ask (react-i18next, a global chat store, a generic side-panel overlay system, a dark/light theme context).
   TIMS keeps its own auth, i18n, tRPC, manifest-driven nav, Modal/Drawer — only the chrome's *code and
   appearance* change to match FormMaps' pattern.
2. **Chrome color = dark blue `#052642`** (custom, not any single FormMaps value — arrived at through 3 rounds
   of live prototype darkening from FormMaps' documented "Primary Blue" `#065292`). Teal `#2E9098` (FormMaps'
   current accent) is retained as the active-nav-item highlight against the dark blue — validated as readable
   and visually coherent in the prototype.
3. **[DEFAULT, unconfirmed] Breadcrumb kept, restyled to the new compact 40px top-bar density** rather than
   removed to match FormMaps' breadcrumb-less top bar exactly. Federico did not respond when asked; this is
   the lower-risk default (preserves an existing usability feature). **Reversible in one line if he wants
   FormMaps' exact breadcrumb-less bar** — override on spec review if so.
4. **[DEFAULT, unconfirmed] Dark/light/system theme picker = OUT OF SCOPE.** TIMS ships the dark-blue chrome
   only, no theme switching. FormMaps' theme picker wasn't shown in the reference screenshot and is
   orthogonal to "replicate the shell" — building theme-switching infrastructure from scratch would be a
   scope increase into a new feature, not a shell-parity port.
5. **AI-chat-in-sidebar (Home/Chat tab switcher), `SidePanelContextProvider`/`SidePanelRenderer`** — excluded.
   These are FormMaps app features, not shell chrome. TIMS has no equivalent need and already has its own
   Modal/Drawer/SupportChat covering the same interaction space. (This exclusion predates this session — it
   was already agreed before the "identical" instruction, and that instruction was about visual identity, not
   about adding FormMaps' AI chat feature to TIMS.)
6. **Sub-nav capability (nested items + tree-line connector) is ported as INFRASTRUCTURE ONLY** — the
   component and `NavItem` type gain `sub?: NavSubItem[]` support, demonstrated in the prototype, but **no
   existing TIMS manifest section is regrouped into a nested hierarchy** as part of this task. Deciding which
   of TIMS's 7 role manifests would actually benefit from nesting is a separate IA decision, out of scope here.
7. **All 3 TIMS sidebar variants get the treatment**: `sidebar.tsx` (7 org roles), `platform-sidebar.tsx`
   (platform_owner), `participant-sidebar.tsx` (committee/employee) — this is shell chrome shared across every
   authenticated view, not a single role's page.
8. **TIMS's manifest-driven nav (`lib/nav/manifest.ts`) is the unchanged source of truth.** It is already more
   sophisticated than FormMaps' flat `NAV_SECTIONS` array (permission-gated pruning across 7 roles) — nothing
   about the nav *data* changes, only how it renders.

## Design tokens

New CSS custom properties in `apps/web/app/globals.css`, split into two token families so the white main
content panel never changes regardless of chrome color:

**Chrome tokens** (sidebar + top-bar background/text — dark blue mode):
```css
--chrome-bg: #052642;
--chrome-text-primary: #ffffff;
--chrome-text-secondary: rgba(255,255,255,.78);
--chrome-text-tertiary: rgba(255,255,255,.55);
--chrome-text-light: rgba(255,255,255,.4);
--chrome-hover: rgba(255,255,255,.08);
--chrome-border-light: rgba(255,255,255,.14);
--chrome-accent-active: #2E9098;      /* active nav item background */
--chrome-logo-bg: #ffffff; --chrome-logo-text: #052642;
```

**Content tokens** (main panel — copied verbatim from FormMaps `colorsLight`, since the panel stays light
regardless of chrome color):
```css
--content-bg-panel: #ffffff; --content-bg-hover: rgba(0,0,0,.04);
--content-border-default: #e0e0e0; --content-border-light: #eee;
--content-font-primary: #141414; --content-font-secondary: #474747;
--content-font-tertiary: #818181; --content-font-light: #999;
```

**Spacing/radius/layout** (copied verbatim from FormMaps `spacing.ts`):
```
sidebarExpanded: 220px    sidebarCollapsed: 52px    navItemHeight: 28px
radius sm/md/lg/xl: 4px/6px/8px/12px    contentPaddingX: 32px    contentPaddingY: 24px
```

**Typography:** Poppins for the sidebar (new — TIMS has no Poppins today, load via `next/font/google` for
self-hosted build-time bundling, not a runtime CDN call), Inter for everything else (TIMS already uses this
site-wide, unchanged).

## Component changes

1. **`apps/web/app/globals.css`** — add the token blocks above; no changes to TIMS's existing
   `--color-brand`/`--color-brand-red` tokens (those remain defined for any code that still references them
   during a transition, though the shell itself stops using them).
2. **`apps/web/app/(admin)/admin-shell.tsx`** — restructure to match `AppShell.tsx`'s flex layout: full-height
   flex column, sidebar + right-column split, right column = top bar (40px) + bordered/rounded white main
   panel with internal padding (`contentPaddingX`/`contentPaddingY`). Keep `ImpersonationBanner`,
   `RouteAccessGuard`, `TRPCProvider`, `PermissionsProvider`, `I18nProvider`, `SupportChat` exactly as-is
   (orthogonal to the visual restructure).
3. **`apps/web/app/(admin)/navbar/index.tsx`** — restyle to the compact 40px bar; breadcrumb stays (decision
   #3 above) but restyled to the new density/font-size; search (`SearchCommand`, already exists) and
   notifications (`NotificationDropdown`, already exists) restyled to FormMaps' compact icon-button treatment,
   not rebuilt.
4. **`apps/web/app/(admin)/sidebar.tsx` + `platform-sidebar.tsx` + `participant-sidebar.tsx`** — each:
   - Collapse width 240px→220px expanded, 72px→52px collapsed; row height 40px→28px.
   - Active-item styling: `bg-white/10` overlay on navy → solid `--chrome-accent-active` (teal) with white text.
   - Collapse toggle moves from the bottom nav row to the top-right of the logo bar (matches FormMaps
     position); icon becomes a panel-close/panel-open style.
   - Bottom user block becomes a single profile button opening an upward dropdown (Settings, **Security/MFA**
     — folded in as an extra item since TIMS has no equivalent in FormMaps' menu, Sign out) instead of the
     current always-visible avatar+name+separate icon buttons.
   - `NavItem`/`NavSection` types in `lib/nav/manifest.ts` gain optional `sub?: NavSubItem[]` (infrastructure
     only, per decision #6 — no existing manifest section actually uses it yet).
   - Section labels: 10px uppercase, `--chrome-text-light`.
5. **Logo:** TIMS keeps its own name/logo (obviously — no FormMaps wordmark), sized/positioned to match the
   logo-bar layout (28px mark + wordmark when expanded, mark-only when collapsed).

## Explicitly not changing
- Auth, permissions, tRPC, i18n, RLS — zero backend/data-layer touch, this is pure rendering.
- `lib/nav/manifest.ts`'s actual section/item lists (no IA changes) — only its types gain optional
  sub-item support (decision #6).
- Any non-shell page content (dashboards, tables, forms) — this spec is chrome only.

## Testing / verification plan
- Full local gate: `prisma generate` → api tsc → web tsc → `npx vitest run` → `next build` (matches every
  prior TIMS PR this session).
- **Full role-matrix Playwright check** — this is the largest-blast-radius change of the session (touches
  every authenticated page's shell for all 7 org roles + platform_owner + committee/employee participants).
  Verify: sidebar renders correctly (expanded + collapsed) for each of the 7 `NAV_ROLES` manifests, the
  platform-owner shell, and the participant shell; collapse/expand persists via existing `localStorage` key;
  profile dropdown opens/closes correctly; breadcrumb still resolves per-route; no layout regression on any
  page that assumes the old sidebar width/top-bar height in its own CSS (grep for hardcoded assumptions before
  merging).
- No new tests strictly required for the CSS/JSX restyle itself (mechanical, visually verified), but any
  behavioral change (collapse toggle relocation, profile-menu-as-dropdown-vs-always-visible) should get a
  regression test if TIMS has existing shell tests to extend.

## Process
Build via `superpowers:subagent-driven-development`, same proven pattern as the M4pt2 ErrorState wiring
(PR #112): task-scoped implementer + reviewer per component group, then a whole-branch review + Codex
adversarial review (`.claude/rules/verification.md`) before shipping as one PR, given every change here is
presentational/reversible and the pattern already worked well this session.
