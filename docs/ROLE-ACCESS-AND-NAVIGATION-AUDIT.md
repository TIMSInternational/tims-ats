# TIMS ATS — Role Access & Navigation Audit

> **Date:** 2026-06-16 · **Author:** NexaDev · **Status:** Audit / alignment artifact (pre-build)
> **Purpose:** Define, per user role, (1) what they *should* be able to do, (2) what their navigation *should* look like, and (3) where the current implementation falls short. This is the alignment document for rebuilding role experiences as **purpose-built**, not **subtractively-filtered** from the super-admin view.

---

## 0. The core problem (executive summary)

Wave 2.5 shipped a working access-control *kernel* (roles, scopes, field classification, audit, sidebar filtering). But the role *experience* is **subtractive**: there is **one** static admin sidebar (22 items) and every staff role sees *that list minus the items it can't `read`*. A recruiter, a leader, an employee each get a **lobotomized super-admin view**, not an interface designed for their job. Three compounding problems:

1. **Subtractive navigation, not role-native IA.** One `Sidebar` component, filtered by `can(module,'read')`. All staff land on the *same* `/dashboard`. No role gets navigation organized around *their* workflow, *their* vocabulary, or a landing screen built for them. (Platform owner is the only role with a separate nav.)

2. **The live permission grants are materially thinner than what the client signed off on.** The authoritative source is the seed (`seed-access.ts`), and it under-grants nearly every role versus the client spec (§2 of *Especificación del Proyecto*) and our own Architecture doc. Concrete, confirmed-against-client examples: leader cannot read candidates, recruiter cannot create offers, hrbp is read-only with no monitoring.

3. **The permission vocabulary has drifted and decayed.** `DEFAULT_ROLE_PERMISSIONS` in `roles.ts` is dead code that disagrees with the seed for *every* role; six "modules" granted to roles have no backing router (`evaluation`, `commitment`, `coaching`, `talent`, `team`, `lnd`); five live modules are missing from the `Module` type; the `publish` action isn't in the `Action` type.

**Critical framing for what follows:** gaps come in two kinds — (A) **misconfiguration** of a *built* feature (wrong/missing grant, wrong IA) → fixable now, cheap; (B) **unbuilt feature** (360, commitments, recognition — post-MVP phases not yet developed) → these are roadmap, not bugs. Each gap below is tagged **[CONFIG]** or **[UNBUILT]**.

---

## 1. Sources of truth

| Source | What it authoritatively defines | Notes |
|---|---|---|
| **Client spec** `…/clients/tims-international/docs/TIMS ATS - Especificación del Proyecto.pdf` §2 "Qué Podrán Hacer los Usuarios" | **What each of the 9 roles is approved to do** (client-signed) | v2.0, 25-may-2026, "EN REVISIÓN". The contractual role definition. |
| `docs/TIMS ATS - Architecture.md` §745-759 (role table), §21 (sensitive-data matrix, lines 2472-2553), §19 (per-role screen annexes) | Role scopes; per-data-type access; per-role screens per module | NexaDev-authored elaboration of the client spec. |
| `packages/db/prisma/seed-access.ts` MATRIX | **The grants actually live in prod** (`rolePermission` rows the kernel reads) | THE source of truth for current behavior. |
| `packages/shared/src/types/roles.ts` `DEFAULT_ROLE_PERMISSIONS` | (nothing — **dead code**, never read by the kernel) | Diverges from seed for every role. Landmine. |
| `apps/web/app/(admin)/sidebar.tsx` + `apps/web/lib/permissions.tsx` | Current navigation IA + subtractive filter | One list, `can(module,'read')` filter. |

**Client role table (verbatim, §2 — the contract):**

| Usuario (role) | Qué puede hacer (client-approved) |
|---|---|
| Administrador (`super_admin`) | Acceso total: configuración de la plataforma, permisos, facturación, integraciones, todos los módulos |
| Director de RRHH (`hr_admin`) | Gestionar todos los procesos de RRHH: reclutamiento, desempeño, evaluaciones, compensación, reportes |
| HRBP (`hrbp`) | Gestionar los procesos de HR para las unidades de negocio asignadas. Monitoreo estratégico de sus áreas |
| Reclutador (`recruiter`) | Crear vacantes, gestionar candidatos en el pipeline, asignar evaluaciones, programar entrevistas, **crear ofertas** |
| Líder / Jefe (`leader`) | Solicitar vacantes, **revisar candidatos finalistas**, entrevistar, aprobar ofertas. Post-contratación: gestionar OKRs, coaching, evaluaciones de su equipo |
| Miembro de Comité (`committee`) | Participar en paneles de entrevista, completar scorecards, calibrar posiciones en Nine Box |
| Empleado (`employee`) | Ver y actualizar sus OKRs, completar cursos, **responder evaluaciones 360**, participar en encuestas, ver sus beneficios |
| Candidato (`candidate`) | Buscar vacantes, postularse, realizar evaluaciones, atender entrevistas, revisar y aceptar ofertas, subir documentos |
| Proveedor Externo (`external`) | **Enviar resultados de verificaciones o evaluaciones externas** (acceso limitado solo a lo necesario) |

---

## 2. The permission vocabulary (current state + drift)

**Modules in use (24, via `permissionProcedure`):** vacancy, pipeline, candidate, assessment, interview, offer, onboarding, performance, learning, ninebox, succession, team_intel, engagement, dei, compensation, monitoring, organization, user, billing, integration, audit, feature_flags, notification.

**Actions in use (7):** read, create, update, delete, approve, **publish** (vacancy only), export (dei, audit).

**Scopes (5):** own, team, unit, company, organization.

### Vocabulary defects to fix [CONFIG]

| Defect | Detail | Impact |
|---|---|---|
| `DEFAULT_ROLE_PERMISSIONS` is dead + wrong | `roles.ts` constant never read by `buildAccessForUser`; disagrees with seed for every role | Anyone "fixing permissions" there changes nothing — silent landmine. Delete it or regenerate it FROM the seed. |
| 6 dead modules granted to roles | `evaluation`, `commitment`, `coaching`, `talent`, `team`, `lnd` — granted in `roles.ts` but **no router uses them**; coaching is folded into `performance` | Grants resolve to no-ops. `lnd` vs `learning` is the dangerous one: if anything seeded from `roles.ts`, employees would lose LMS access. |
| 5 live modules missing from `Module` type | `succession`, `team_intel`, `learning`, `feature_flags`, `notification` used at runtime but absent from `permissions.ts` union | Type no longer guards module strings; typos won't be caught. |
| `publish` action not in `Action` type | `vacancy:publish` used in `channels.ts` but `ACTIONS` union omits it | Same — untyped. |
| Org-admin screens absent from org sidebar | No nav item for **audit log**, **feature flags**, **organization settings**, or **user management** in the org `Sidebar`; they live only under `/platform/*` (owner) | super_admin/hr_admin can't navigate to org administration they're entitled to. |

---

## 3. Per-role audit

Legend for capability tables: **✓ have** (granted & correct) · **✗ MISSING [CONFIG]** (feature built, grant wrong — fix now) · **⏳ [UNBUILT]** (feature not developed yet — roadmap).

---

### 3.1 `super_admin` — "Administrador" (org-level full access)

- **Scope:** organization. **Resolution:** privileged bypass in `build.ts` (never DB-checked) → org-wide on everything.
- **Client mandate:** total access incl. config, permissions, billing, integrations, all modules.

**Should-have navigation (role-native):** the full IA, and it's the *reference* IA all other roles are a curated subset of. Sections: **Command Center** (org-wide exec dashboard) · **Recruitment** (pipeline, vacancies, candidates, interviews, assessments, offers, talent pool, analytics) · **People** (onboarding, performance, learning) · **Talent** (nine-box, succession, team intelligence) · **Culture & Strategy** (engagement, DEI, compensation, monitoring) · **Administration** (organization settings, **users & roles**, business units, billing, integrations, **feature flags**, **audit log**).

**Current state:** sees the full 22-item filtered sidebar (privileged bypass). **Lands on `RecruiterDashboard`** (recruitment-funnel framed).

**Gaps:**
- **IA [CONFIG]:** the org sidebar has **no Administration section** — `organization settings`, `users & roles`, `feature flags`, `audit log` are missing as nav items (only `business-units`, `billing`, `integrations` exist). super_admin must reach org administration but can't navigate to it.
- **IA [CONFIG]:** default dashboard is recruitment-framed; a super_admin/org owner wants an org-health overview spanning recruitment + people + culture.

---

### 3.2 `hr_admin` — "Director de RRHH" (org-wide HR, minus platform admin)

- **Scope:** organization (DB-checked). **Lost (deliberately, Jun 11):** audit, feature_flags, billing, integration; organization downgraded to read-only.
- **Client mandate:** manage *all* HR processes org-wide: recruitment, performance, evaluations, compensation, reports.

**Should-have capabilities** (vs seed):

| Module | Should | Have? |
|---|---|---|
| vacancy/pipeline/candidate/assessment/interview/offer | r/c/u (+approve offers, +publish/approve vacancy) | ✓ (has r/c/u/d + approve + publish) |
| onboarding, performance, learning | r/c/u | ✓ (performance/onboarding) ; learning create ⏳ may be admin-authoring |
| ninebox, succession, team_intel | full (read + manage) | partial — has read; **nine-box calibrate/manage, succession edit** ✗ verify |
| engagement, dei | read + manage surveys + export | ✓ (dei r+export; engagement r) ; **survey authoring c/u** ✗ verify |
| compensation | r + approve | ✓ |
| monitoring | r + configure | ✓ (r+u) |
| 360 evaluations, recognition, commitments analytics | manage cycles | ⏳ **[UNBUILT]** |
| organization | read | ✓ (read-only by design) |

**Should-have navigation:** everything *except* the platform-admin items (billing, integrations, feature flags, audit), with **People / Talent / Culture as the primary sections** and Recruitment as oversight. Landing = **HR executive dashboard** (headcount, open reqs, performance-cycle status, engagement pulse, DEI snapshot, comp distribution) — not the recruiter funnel.

**Current state:** filtered admin sidebar (sees all HR + recruitment; billing/integrations visible only if granted — they aren't, so hidden). Lands on `RecruiterDashboard`.

**Gaps:**
- **IA [CONFIG]:** lands on a recruitment dashboard; needs an HR-exec dashboard. Section ordering is recruitment-first; for an HR director it should be people/talent/culture-first.
- **CONFIG (verify):** confirm hr_admin can author surveys (engagement:create/update) and calibrate nine-box / edit succession — client says "gestionar evaluaciones"; seed shows several of these as read-only.
- **[UNBUILT]:** 360 cycles, recognition, commitments are post-MVP — not a grant bug.

---

### 3.3 `hrbp` — "HR Business Partner" (assigned units; **manage**, not just read)

- **Scope:** unit (assigned `UserBusinessUnit` rows). **Client mandate:** *manage* HR processes for assigned units + strategic monitoring of their areas.

**Should-have vs current (the gap is large):**

| Module | Should (per client "gestionar" + Architecture) | Current seed | Gap |
|---|---|---|---|
| vacancy | r/c/u @unit | **r only** | ✗ create/update **[CONFIG]** |
| pipeline | r/u @unit | **r only** | ✗ update **[CONFIG]** |
| candidate | r/u @unit | **r only** | ✗ update **[CONFIG]** |
| interview | r/c @unit | **r only** | ✗ create **[CONFIG]** |
| offer | r/approve @unit | **r only** | ✗ approve **[CONFIG]** |
| onboarding | r/c/u @unit | r/c/u ✓ | ✓ |
| performance | r/u @unit | **r only** | ✗ update **[CONFIG]** |
| learning, ninebox, succession, engagement, compensation | r @unit | r ✓ | ✓ (read) |
| **monitoring** | **r @unit** ("monitoreo estratégico de sus áreas") | **absent** | ✗ **[CONFIG]** — explicit client requirement missing |

**Should-have navigation:** mirrors hr_admin's People/Talent/Culture/Recruitment sections **but framed as "Mis Unidades"** — every screen scoped + labeled to their assigned units, with a unit-health landing dashboard. Add **Monitoring** (their strategic dashboards).

**Current state:** filtered admin sidebar; data unit-scoped (RLS + scope). But read-only on most modules → an HRBP today **cannot move a candidate, update a vacancy, approve an offer, or update a performance review in their own unit** — directly contradicts "gestionar."

**Gaps:** large **[CONFIG]** capability gap (write access + monitoring) + IA gap (not framed as "my units," no unit dashboard).

---

### 3.4 `recruiter` — "Reclutador" (ATS only, org-wide)

- **Scope:** organization. **Client mandate:** create vacancies, manage pipeline candidates, assign assessments, schedule interviews, **create offers**.

**Should-have vs current:**

| Module | Should | Current seed | Gap |
|---|---|---|---|
| vacancy | r/c/u + **publish** | r/c/u/d (no publish) | ✗ **publish [CONFIG]** — recruiters post to job boards |
| pipeline, candidate, interview | r/c/u | r/c/u/d ✓ | ✓ (delete extra — review if intended) |
| assessment | r/c/u (assign) | r/c/u ✓ | ✓ |
| **offer** | **r/c** ("crear ofertas") | **r only** | ✗ **create [CONFIG]** — explicit client requirement |

**Should-have navigation:** **pure ATS shell** — Command Center (recruiting) · Pipeline · Vacancies · Candidates · Interviews · Assessments · Offers · Talent Pool · Analytics. **No** People/Talent/Culture/Administration. Landing = recruiting command center.

**Current state:** the subtractive filter already yields a near-correct ATS-only sidebar (recruiter has no people/talent grants, so those sections vanish). This is the role the current architecture serves *least badly*. Lands on `RecruiterDashboard` (appropriate).

**Gaps:** **[CONFIG]** capability: `offer:create` + `vacancy:publish`. IA is mostly fine (validate offers/talent-pool labels). This proves the point: where the grants happen to match, subtractive filtering *looks* fine — but it's coincidental, not designed.

---

### 3.5 `leader` — "Líder / Jefe" (team; two distinct jobs)

- **Scope:** team (`Team.leaderId = user.id`). **Client mandate:** request vacancies, **review finalist candidates**, interview, approve offers; post-hire: manage team OKRs, coaching, evaluations.

**Should-have vs current:**

| Module | Should | Current seed | Gap |
|---|---|---|---|
| vacancy | r + request(create?) + approve @team | r/approve | request/create ✗ (verify "solicitar") **[CONFIG]** |
| **candidate** | **r @team** ("revisar candidatos finalistas") | **absent** | ✗ **[CONFIG] — leader can approve a vacancy & interview but CANNOT open the candidate** |
| pipeline | r @team | r/u ✓ | ✓ |
| interview | r/c/u @team | r/c/u ✓ | ✓ |
| offer | r/approve @team | r/approve ✓ | ✓ |
| onboarding, performance | r/u/c @team | r/u, performance r/c/u ✓ | ✓ |
| coaching | (via `performance` module) | covered by performance ✓ | ✓ (dead `coaching` module is a red herring) |
| learning, ninebox, succession, team_intel, engagement, compensation | r @team | r ✓ | ✓ (read) |
| recognition / commitments | give recognition, assign commitments | — | ⏳ **[UNBUILT]** |

**Should-have navigation (a *manager cockpit*, two worlds):**
- **My Hiring**: team vacancies, **finalist candidates**, interviews I'm on, offers to approve.
- **My Team**: team OKRs/performance, coaching & 1:1s, team learning, team nine-box (read), team engagement (aggregate), team compensation (read), recognition.
- Landing = **manager dashboard**: open reqs + pending approvals (offers/scorecards) + team performance/engagement snapshot.

**Current state:** filtered admin sidebar (shows the modules they can read — but **candidate is hidden** because no grant, breaking "review finalists"). Lands on `LeaderDashboard` (thin: 3 vacancy KPIs + links) — and **committee is wrongly bucketed into this same dashboard**.

**Gaps:** **[CONFIG]** `candidate:read@team` (critical), verify `vacancy:create@team` for "solicitar"; **IA**: needs the two-world manager cockpit, not a filtered admin list; dashboard is thin and mis-shared with committee.

---

### 3.6 `committee` — "Miembro de Comité" (panels & calibration only)

- **Scope:** panel/session membership (`InterviewEvaluator`, calibration members). **Client mandate:** participate in interview panels, complete scorecards, calibrate Nine Box positions.

**Should-have vs current:** seed = `interview r/c/u @team` + `ninebox r/u @team`. **This matches the client mandate** (scorecards + calibration). The dead `roles.ts` had `evaluation@own` — wrong; the seed is correct.

| Module | Should | Current | Gap |
|---|---|---|---|
| interview | r + submit scorecard (create/update) — *assigned panels only* | r/c/u @team (+ `assertScoped`) | ✓ (grant correct; scope enforced) |
| ninebox | r/u — *assigned calibration sessions only* | r/u @team (+ `requireOrgScope`) | ✓ |

**Should-have navigation:** the *most over-served* role today. A committee member is an occasional participant, not an admin. They should get a **minimal, task-focused shell**: "**My Panels**" (interviews assigned to me → scorecard) + "**My Calibrations**" (nine-box sessions I'm in). No admin chrome, no other sections. Landing = "my assigned tasks."

**Current state:** gets the full admin shell, filtered to just interviews + nine-box; bucketed into `LeaderDashboard`. Functionally works, experientially wrong (an evaluator dropped into an HR admin app).

**Gaps:** **IA only [CONFIG]** — needs a focused panelist experience, not the admin shell. Grants are correct.

---

### 3.7 `employee` — "Empleado" (self-service)

- **Scope:** own. **Client mandate:** view/update own OKRs, complete courses, **respond to 360 evaluations**, participate in surveys, view benefits.

**Should-have vs current:**

| Module | Should | Current seed | Gap |
|---|---|---|---|
| performance (OKRs, my reviews, my coaching) | r/c/u @own | r/c/u ✓ | ✓ |
| learning | r @own (+ enroll/complete) | r ✓ | ✓ (verify enroll action) |
| engagement (respond to surveys) | r/c @own | r/c ✓ | ✓ |
| compensation (my benefits) | r @own | r ✓ | ✓ |
| onboarding (if new hire) | r/u @own | r/u ✓ | ✓ |
| **360 evaluations** ("responder evaluaciones 360") | r/c @own | **module doesn't exist** | ⏳ **[UNBUILT]** (Fase 7) |
| commitments | r/u @own | **module doesn't exist** | ⏳ **[UNBUILT]** (Fase 7) |
| recognition (kudos) | give/receive | — | ⏳ **[UNBUILT]** (Fase 6) |
| data consent / export | manage own | partial (consent layer exists) | verify self-service surface |

**Should-have navigation:** employees are the **most numerous** users and deserve a **distinct self-service experience**, not the admin shell filtered to 5 items. A light portal: **My Dashboard** (tasks, OKR progress, pending surveys/evals) · **My Performance** (OKRs, reviews, coaching) · **My Learning** · **My Evaluations** (360) · **My Surveys** · **My Compensation & Benefits** · **My Onboarding** (when applicable) · **My Profile & Privacy** (consent, data export).

**Current state:** `EmployeeDashboard` (2 quick-action tiles) + the admin shell filtered to onboarding/performance/learning/engagement/compensation. The admin chrome (dense HR-admin nav) is wrong for a self-service user.

**Gaps:** **IA [CONFIG]** (self-service shell, not admin) + **[UNBUILT]** 360/commitments/recognition features.

---

### 3.8 `candidate` — "Candidato" (portal, non-staff)

- **Mechanism:** dedicated `candidateProcedure` (Supabase magic-link, no RBAC role, no staff sidebar). Separate client-branded portal (`{client}.tims.com`). **Out of scope for the staff sidebar audit** — already a correctly-separated experience.
- **Client mandate:** browse vacancies, apply, take assessments, attend interviews, review/accept offers, upload documents. Wave 1 shipped applications + interviews + offers; **assessment player backend** is the known pending piece (Wave 1.5a).

---

### 3.9 `external` — "Proveedor Externo" (API, non-UI) ⚠️ product-alignment question

- **Mechanism:** API-key (`externalProcedure`), no UI. We shipped a **read** surface for assessment results (Wave 2.5 slice 7b).
- **Client mandate (verbatim):** *"Enviar resultados de verificaciones o evaluaciones externas (acceso limitado solo a lo necesario)."* — i.e., **SEND/submit** results of background checks or external assessments (an **inbound** integration), "limited access to only what's necessary."
- **GAP / DECISION:** what we built (external *reads* the full psychometric profile) is closer to an **outbound analytics** consumer than the client's described **inbound verification-results** provider. These are different products. Federico's Jun 15 decision was deliberate (analysis-engine consumer), but it diverges from the signed spec. **Needs an explicit reconcile:** is `external` (a) an inbound provider that POSTs verification/assessment results, (b) an outbound analytics reader, or (c) both? This changes the grant (`assessment:read` vs a write/ingest surface) and the whole surface design.

---

## 4. Cross-cutting findings & recommendations

### A. Replace subtractive filtering with role-native IA *(the headline fix)*
- Keep one access kernel, but drive navigation from a **per-role IA definition** (sections, ordering, labels, landing) rather than "the full list minus what you can't read." Concretely:
  - A **role → nav-manifest** map (sections + items + order + landing route), with `can()` as a *safety filter on top*, not the primary selector.
  - **Role-appropriate landing pages**: org dashboard (super_admin), HR-exec dashboard (hr_admin/hrbp), recruiting command center (recruiter), manager cockpit (leader), my-tasks (committee), self-service home (employee).
  - **Two shells, not one:** a full **Admin shell** (super_admin, hr_admin, hrbp, recruiter) and a lighter **Self-service / participant shell** (employee, committee) — employees and committee members should not be dropped into the HR-admin chrome. (Mirrors the candidate-portal separation that already works well.)

### B. Fix the live grants to match the signed spec *(re-seed) [CONFIG]*
Minimum corrections to `seed-access.ts` (then migrate `rolePermission` + flush cache):
- **leader**: + `candidate:read@team` (critical); verify `vacancy:create@team` for "solicitar".
- **recruiter**: + `offer:create@organization`, + `vacancy:publish@organization`.
- **hrbp**: promote read-only → manage where client says "gestionar": + `vacancy:create/update`, `pipeline:update`, `candidate:update`, `interview:create`, `offer:approve`, `performance:update` (all @unit); + `monitoring:read@unit`.
- **hr_admin**: verify survey authoring (`engagement:create/update`), nine-box calibrate, succession edit.
- Each change needs a one-line client-spec citation in the seed (traceability).

### C. Repair the permission vocabulary [CONFIG]
- **Delete or regenerate `DEFAULT_ROLE_PERMISSIONS`** from the seed (it's dead and misleading).
- Remove dead-module grants (`evaluation`, `commitment`, `coaching`, `talent`, `team`, `lnd`) OR (better) build the modules they imply (see D). Resolve `lnd`→`learning`.
- Add `succession`, `team_intel`, `learning`, `feature_flags`, `notification` to the `Module` type; add `publish` to `Action`. Re-enable type-checking of module/action strings.
- Add the missing **org-admin nav** (organization settings, users & roles, feature flags, audit log) to the org shell for super_admin (+ the subset hr_admin is entitled to).

### D. Distinguish unbuilt features from misconfig [UNBUILT]
Several "role gaps" are simply **post-MVP phases not yet built**: 360 evaluations (Fase 7), commitments/KPIs (Fase 7), recognition/kudos (Fase 6). The roles' *eventual* grants are correct; the *features* don't exist yet. These belong on the build roadmap, not the re-seed. (The client spec's 27-module / 10-phase plan is the source for sequencing.)

### E. Dashboard buckets
Current `/dashboard` branches into 4 components for 7 roles, and **mis-buckets committee with leader**. Replace with the role-native landings in (A).

---

## 5. Proposed next steps (for decision)

1. **Decide IA model** — per-role nav manifests + role landings, and whether to split a self-service shell from the admin shell (recommended).
2. **Approve the re-seed corrections** (§4B) — these are cheap, high-impact, and directly close client-spec gaps on *built* features. Can ship as one access-fix slice.
3. **Resolve the `external` provider-vs-reader question** (§3.9).
4. **Sequence the unbuilt role features** (360, commitments, recognition) against the client phase plan.
5. Repair the vocabulary (§4C) alongside the re-seed.

Then: brainstorm → plan → build the role-native experiences (subagent-driven, per the established doctrine), starting with the re-seed + IA for the highest-impact roles (leader, hrbp, employee).

---

*Appendix data (full current grant matrix, full nav IA, sensitive-data matrix §21, module×action grid) captured in the audit working notes; cite `seed-access.ts`, `sidebar.tsx`, `permissions.tsx`, Architecture §19/§21 for specifics.*
