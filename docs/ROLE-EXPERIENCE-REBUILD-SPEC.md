# TIMS ATS — Role Experience Rebuild Spec

> **Date:** 2026-06-16 · **Author:** NexaDev · **Status:** Design spec — LOCKED (ready to plan)
> **Companion:** `ROLE-ACCESS-AND-NAVIGATION-AUDIT.md` (the diagnosis). This doc is the **normative build target** (the decisions).
> **Goal:** Replace subtractive navigation ("super-admin's nav minus what you can't read") with **purpose-built, role-native experiences** — corrected grants, a manifest-driven IA, two shells, and a bespoke landing per role.

---

## 0. Decisions locked (brainstorm output)

| # | Decision | Resolution |
|---|---|---|
| D1 | HRBP offer authority | **Read-only on offers** — approval stays leader/hr_admin |
| D2 | Recruiter delete on funnel objects | **Keep delete** (owns their funnel) |
| D3 | Leader "solicitar vacantes" | **`vacancy:create@team`** → routes through approval chain |
| D4 | Landing scope | **Build all 7 bespoke landings now** (architecturally complete) |
| D5 | Nav labels | **Existing i18n keys, Spanish default** (en available); unbuilt items omitted until shipped |
| D6 | `external` role | **Defer** — own track, keep shipped reader live; not in this rebuild |
| D7 | Slice sequence | **Accepted as drafted** (§5): Substrate → Engine → Leader → HR-exec → Participant → Unbuilt |

---

## 1. Architecture

**Principle:** IA (product) is separate from access (security). The Wave 2.5 kernel stays the boundary; the manifest is UX-only.

- **Navigation source of truth = a per-role manifest**, not a filtered global list:
  ```ts
  type NavItem    = { label: I18nKey; route: string; module: Module; action?: Action; icon: Icon };
  type NavSection = { label: I18nKey; items: NavItem[] };
  type RoleManifest = { shell: 'admin' | 'participant'; landing: string; sections: NavSection[] };
  const MANIFESTS: Record<Role, RoleManifest> = { ... };
  ```
- **`can()` is a safety filter on top, never the selector.** The manifest declares intent; `can(module, action)` prunes anything the live grant doesn't permit. A manifest item that 403s is a manifest/grant bug to fix, not the design.
- **Two shells** (a real difference in frequency/density/mental-model, mirroring the candidate portal that already works):
  - **Admin shell** — `super_admin`, `hr_admin`, `hrbp`, `recruiter`, `leader`
  - **Participant shell** — `committee`, `employee`
- **Authoring discipline:** each manifest is built **bottom-up from the role's job** (client spec §2 → screens → order by frequency). Never top-down by deleting from the full list. This is what prevents regression to subtractive.

---

## 2. Corrected grant matrix (normative re-seed target)

Source of truth = `seed-access.ts`. Only roles that change are shown; `super_admin` (privileged bypass), `hr_admin`, `committee`, `employee` are already correct for built features. Each change carries a client-spec §2 citation in the seed.

| Role | Change vs live seed | Citation |
|---|---|---|
| **leader** | `+ candidate:read@team` · `+ vacancy:create@team` | "revisar candidatos finalistas" / "solicitar vacantes" |
| **recruiter** | `+ offer:create@organization` · `+ vacancy:publish@organization` (keeps `delete`) | "crear ofertas" |
| **hrbp** | read-only → **manage @unit**: `+ vacancy:create/update`, `pipeline:update`, `candidate:update`, `interview:create`, `performance:update` · `+ monitoring:read@unit` · offer stays **read-only** | "gestionar los procesos de HR... monitoreo estratégico" |
| **hr_admin** | none (verify survey authoring / nine-box calibrate / succession edit during Slice 3) | already aligned |

**Vocabulary repairs (Slice 0):** delete dead `DEFAULT_ROLE_PERMISSIONS`; remove 6 dead-module grants (`evaluation`, `commitment`, `coaching`, `talent`, `team`, `lnd`); add `succession`, `team_intel`, `learning`, `feature_flags`, `notification` to `Module`; add `publish` to `Action`; add org-admin nav modules (org settings, users & roles, feature flags, audit log).

---

## 3. Per-role IA manifest (normative)

Legend: ⏳ = unbuilt feature, omitted from nav until its slice ships (D5).

### Admin shell

**`super_admin`** · landing **Org Command Center** (org-health: recruiting + people + culture rollup)
- **Command Center**
- **Recruitment** — Pipeline · Vacancies · Candidates · Interviews · Assessments · Offers · Talent Pool · Analytics
- **People** — Onboarding · Performance · Learning
- **Talent** — Nine-Box · Succession · Team Intelligence
- **Culture & Strategy** — Engagement · DEI · Compensation · Monitoring
- **Administration** — Org Settings · Users & Roles · Business Units · Billing · Integrations · Feature Flags · Audit Log *(entirely missing today)*

**`hr_admin`** · landing **HR Executive Dashboard** (headcount, open reqs, cycle status, engagement pulse, DEI, comp)
- **Command Center** · **People** · **Talent** · **Culture & Strategy** *(people-first ordering)* · **Recruitment** *(oversight)* · **Administration** *(reduced: Business Units · Reports — no billing/integrations/flags/audit; org read-only, per Jun 11)*

**`hrbp`** · landing **Unit Health Dashboard** · framing **"Mis Unidades"** (every screen scoped + labeled to assigned units)
- **Command Center** *(unit health)* · **Recruitment** *(unit)* · **People** *(unit)* · **Talent** *(read, unit)* · **Culture & Strategy** incl. **Monitoring** *(unit)*

**`recruiter`** · landing **Recruiting Command Center** · pure ATS (no People/Talent/Culture/Admin)
- **Command Center** · Pipeline · Vacancies · Candidates · Interviews · Assessments · **Offers** · Talent Pool · Analytics

**`leader`** · landing **Manager Dashboard** (open reqs + pending approvals + team perf/engagement snapshot) · **two worlds**
- **My Hiring** — Team Vacancies · **Finalist Candidates** · My Interviews · Offers to Approve
- **My Team** — Team OKRs/Performance · Coaching & 1:1s · Team Learning · Team Nine-Box *(read)* · Team Engagement *(aggregate)* · Team Compensation *(read)* · Recognition ⏳

### Participant shell

**`committee`** · landing **My Tasks**
- **My Panels** *(assigned interviews → scorecard)* · **My Calibrations** *(nine-box sessions I'm in)*

**`employee`** · landing **My Home** (tasks, OKR progress, pending surveys/evals)
- **My Performance** *(OKRs · reviews · coaching)* · **My Learning** · **My Evaluations** *(360 ⏳)* · **My Surveys** · **My Compensation & Benefits** · **My Onboarding** *(conditional on new-hire)* · **My Profile & Privacy** *(consent · data export)*

---

## 4. Out of scope / separate tracks

- **`candidate`** — already a correctly-separated portal (`candidateProcedure`, magic-link). No change.
- **`external`** (D6) — shipped outbound reader (Wave 2.5 slice 7b) stays live. Spec divergence (client describes inbound provider) documented; reconcile decision deferred to its own track.
- **Unbuilt features** (D5) — 360 evals (Fase 7), commitments (Fase 7), recognition (Fase 6). Roadmap, not misconfig. Nav items appear when built.

---

## 5. Slice roadmap (D7)

Ordered so access is correct before IA sits on it (IA on wrong grants = nav items that 403).

| Slice | Ships | Notes |
|---|---|---|
| **0 — Substrate** | Vocabulary repair (§2) + re-seed corrected grant matrix + org-admin nav modules | Wave-data step: migration + cache flush. Cheap, isolated. |
| **1 — Engine** | Manifest infra + 2-shell scaffold + manifest-driven nav (`can()` as safety filter) + **super_admin** & **recruiter** landings | Lowest-risk roles validate the engine. |
| **2 — Leader** | Manager cockpit (My Hiring / My Team) + Manager Dashboard | Highest manager impact; rides Slice 0's `candidate:read`. |
| **3 — HR exec** | **hr_admin** (HR-exec dashboard, people-first IA) + **hrbp** ("Mis Unidades", unit-health, monitoring) | Shared admin-shell taxonomy; biggest capability uplift. |
| **4 — Participant** | Participant shell + **committee** (My Tasks) + **employee** (My Home + self-service) | Pulls most-numerous / most-mis-housed users out of admin chrome. |
| **5+ — Unbuilt track** | 360 · commitments · recognition | Separate roadmap, client phase plan. |

Each slice is independently shippable, testable, and deploys via git push → Vercel. Slice 0 additionally needs `prisma db execute --file=<migration.sql>` against prod (prod is not prisma-migrate-managed) + cache flush.

---

## 6. Per-slice verification (doctrine G2)

For every slice: Explore-per-phase → TDD → self-validate → fresh-reviewer → 4-part user gate. Plus role-specific live probes:
- **Slice 0:** dry-run seed diff must match approved counts before `--apply`; per-role `can()` assertions (leader can read candidate; recruiter can create offer; hrbp can update candidate; hrbp cannot approve offer).
- **Slices 1–4:** each role logs in → lands on its bespoke landing → sees only its manifest sections → no item 403s → no admin chrome leaks into the participant shell.

---

*Plan next (doctrine G1): turn §5 Slice 0 into a written plan, then build subagent-driven.*
