# Contract-Driven Company Entitlements — Design

**Date:** 2026-07-08
**Status:** Approved (design) — pending implementation plan
**Author:** NexaDev (Federico Tafur)

## 1. Context & motivation

The TIMS ATS is a multi-tenant recruitment/selection platform. We are productizing it so that
**each company (tenant) gets a different set of functionalities, activated based on the contract we
signed with them.** INVU (Instituto Nacional de Vivienda y Urbanismo, Costa Rica) is the first
company whose bundle we switch on: a base ATS license plus specific add-ons (e.g. video interviews,
metered).

Today, per-tenant configuration is ad-hoc: a `FeatureFlags` table (raw booleans), `AiAgentOrgConfig`
(AI budget), and a bespoke per-org toggle for the AI-interview add-on (#95). There is no first-class
concept of "what did this company buy" that maps a contract to activated features, with metering and
limits. This design introduces that layer.

This is the **foundational** capability: net-new features (AI compliance engine, real assessment
battery, proctoring) each ship as a **module that plugs into entitlements** and is activated per
contract. Build the gate first; fan out features into it after.

## 2. Goals / non-goals

**Goals**
- Model functionality as a catalog of **modules**, bundled into **plans**, with per-company
  **add-on** activation and **limits**.
- Enforce entitlements server-side (hard gate) and reflect them in the UI (hide/show).
- Meter usage for metered modules (e.g. video minutes) and feed invoicing; **meter-and-bill, never
  hard-block** on overage.
- Give platform-owner a surface to assign plan / toggle add-ons / set limits per company.
- Formalize the existing #95 AI-interview toggle onto this system as the end-to-end proof.

**Non-goals (this spec)**
- Building the net-new features themselves (AI compliance engine, PCA/MIL/etc. scoring). Those are
  separate specs; here we only build the entitlement layer + prove it on one existing feature.
- Self-serve signup / billing automation. Entitlements are set by platform-owner from a signed
  contract.
- Replacing RBAC. Entitlements are an **additional, orthogonal** gate.

## 3. Architecture — the two-gate model

Every feature access passes two independent gates:

1. **RBAC** (existing, unchanged): does this *user's role/scope* allow the action?
   (`can()`, `module:action:scope`; `requireOrgScope` etc.)
2. **Entitlement** (new): is this *feature contracted/activated for this company*?

Both must pass. RBAC answers *who*; entitlement answers *what the company bought*. They compose:
a recruiter (RBAC-allowed) at a company without the `video_interviews` module (not entitled) cannot
launch a video interview; a platform-owner impersonating still cannot use a module the company hasn't
bought (entitlement is company-scoped, not role-scoped).

`FeatureFlags` remains for internal/experimental dev toggles and is **not** the contract layer.

## 4. Data model (`packages/db/prisma/schema`)

New file: `entitlement.prisma`.

- **`Module`** — the catalog of activatable functionalities.
  - `code` (unique, e.g. `vacancies`, `candidate_portal`, `ai_screening`, `compliance_matrix`,
    `assessments`, `interviews`, `video_interviews`, `proctoring`, `validations`, `custom_reports`)
  - `name`, `description`
  - `kind`: `core` | `addon`
  - `metered`: boolean
  - `unit`: nullable (`minutes` | `screenings` | `exams` | `checks` …)
  - `defaultUnitPrice`: nullable decimal (USD)
  - Global catalog (not tenant-scoped); RLS-exempt like other global catalogs.

- **`Plan`** — a named bundle.
  - `code` (unique, e.g. `ats-base`), `name`, `description`, `active`
- **`PlanModule`** — `(planCode, moduleCode)` join: which modules a plan includes, with optional
  default `limit` per module.

- **`OrgEntitlement`** — the **effective per-company activation** (runtime source of truth).
  - `(organizationId, moduleCode)` unique
  - `enabled`: boolean
  - `source`: `plan` | `addon` | `override`
  - `limit`: nullable int (period cap; null = unlimited)
  - `unitPrice`: nullable decimal (per-company price override; else `Module.defaultUnitPrice`)
  - `activatedAt`, `updatedAt`
  - tenant-scoped → RLS `tenant_isolation` policy applies.

Assigning a plan to a company seeds `OrgEntitlement` rows from `PlanModule` (source=`plan`).
Add-ons and limit changes write/patch rows (source=`addon`/`override`). Resolving effective
entitlements = read `OrgEntitlement` for the org.

## 5. Enforcement

- **Resolver:** `getEntitlements(orgId): Map<moduleCode, OrgEntitlement>` in
  `packages/api/src/services/entitlement.service.ts`. Cached in Upstash
  (`tims:entitlements:<orgId>`, 5-min TTL, invalidate-on-update — same pattern as feature flags/KPIs).
- **Guard:** `requireEntitlement(ctx, moduleCode)` in the tRPC/service layer, sitting **next to** the
  existing `can()` check in the shared guard. Throws `FORBIDDEN` (`entitlement_missing`) when the
  module is absent or `enabled=false`. Add a `hasEntitlement(ctx, moduleCode)` non-throwing variant
  for conditional logic.
- **Limits (metered):** `checkLimit(ctx, moduleCode, amount)` reads current period usage vs `limit`.
  Per the approved decision — **meter-and-bill, never hard-block**: over-limit returns an
  `overage: true` signal (logged + invoiced), it does **not** block. Structural caps (seats,
  vacancies) → soft-warn + upsell flag, not a block. (A future `hardBlock` flag on `Module` can opt
  specific modules into blocking if ever needed; default is soft.)
- **Metering:** metered usage logged via the existing `aiAgentUsageLog` pattern (extend or add a
  sibling `usageEvent` table keyed by `(orgId, moduleCode, unit, quantity, occurredAt)`), feeding
  invoice line items (existing invoicing pattern from #95).
- **UI:** the role-experience nav manifest reads entitlements → hides modules the company has not
  activated. Feature entry points check `hasEntitlement` and render disabled/upsell states.

## 6. Admin surface (platform-owner)

Extends the existing platform-owner console (`docs/PLATFORM-OWNER-SPEC.md`). Per company:
- Assign / change **plan** (seeds/reconciles `OrgEntitlement`).
- Toggle **add-on** modules on/off.
- Set **limits** and **unit-price overrides** per module.
- Writes `OrgEntitlement` + invalidates the org's entitlement cache.
- Read-only audit of who changed what, when (reuse existing audit trail).

## 7. First vertical slice (thin, end-to-end proof)

Ship the pattern on ONE existing feature before fanning out:

1. **Schema** — `Module`, `Plan`, `PlanModule`, `OrgEntitlement` + migration.
2. **Seed the catalog** — the module list (§4), a `Plan` `ats-base`, and `PlanModule` rows.
3. **Resolver + guard + cache** — `entitlement.service.ts`, `requireEntitlement`, Upstash cache.
4. **Provision INVU** — seed/console: create INVU org → assign `ats-base` → add-on
   `ai_voice_interview` ON (metered, source=`addon`) → `ai_screening` ON with a cap.
   (Note: `ai_voice_interview` = the existing #95 ElevenLabs feature, which exists today and is the
   proof target. The Daily.co human **`video_interviews`** module — the `$0.02/min` add-on we priced —
   is a *separate, future* module built + entitled in a later slice; it is distinct from #95.)
5. **Migrate #95** — replace the bespoke AI-voice-interview per-org add-on toggle with a first-class
   `ai_voice_interview` module gated by `requireEntitlement(ctx, 'ai_voice_interview')`:
   - server blocks the AI-interview mutations when the module is off,
   - nav/entry points hide when off,
   - metering (voice minutes) flows through the new usage path.
6. **Prove it** — a company without the add-on cannot reach the feature (server + UI); INVU can.

## 8. Testing

- Unit: resolver (plan → effective entitlements), `requireEntitlement` (allow/deny), `checkLimit`
  (under/over → overage signal, no block).
- Integration: gated tRPC procedure returns `FORBIDDEN` without entitlement, succeeds with it; cache
  invalidation on entitlement change.
- Migration parity: #95 behavior preserved (org with add-on = works; without = blocked) via the new
  gate.
- i18n gate: any new UI strings in both `es.json` + `en.json` (no hardcoded strings).
- Full local gate (`prisma generate` → tsc×2 → vitest) green; Codex cross-model review at the build
  gate.

## 9. Risks & open items

- **Assessment battery (delivery risk, out of scope here but noted):** the repo map confirms all
  assessment types (DISC/technical/cognitive/english) are **mock/hardcoded**; PCA/MIL/Integridad/
  Personalidad/IE do **not** exist, and there is **no scoring engine or norm tables**. The
  `assessments` module can be *entitled* now, but its real content is a separate, content-heavy
  track. Do not let entitlement activation imply the assessments are production-ready.
- **AI compliance engine (§6/§7 of the proposal):** also net-new (`cv-parser` exists but no
  requirement-matching). Ships later as the `compliance_matrix` / `ai_screening` module.
- **Plan-change reconciliation:** changing a company's plan must reconcile `OrgEntitlement` without
  clobbering `addon`/`override` rows — resolver rules must be explicit (plan sets `source=plan` rows;
  add-ons/overrides win).
- **Impersonation:** platform-owner impersonating a company inherits that company's entitlements
  (entitlement is company-scoped) — confirm this is the desired behavior in the guard.
