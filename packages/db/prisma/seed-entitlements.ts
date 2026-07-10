// packages/db/prisma/seed-entitlements.ts
import { OrgPlan, type PrismaClient } from '@prisma/client';

export const MODULES = [
  { code: 'vacancies',          name: 'Vacantes',              kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'candidate_portal',   name: 'Portal del candidato',  kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'ai_screening',       name: 'Filtro IA documental',  kind: 'core',  metered: true,  unit: 'screenings',defaultUnitPrice: 0.5 },
  { code: 'compliance_matrix',  name: 'Matriz de cumplimiento',kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'assessments',        name: 'Evaluaciones TIMS',     kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'interviews',         name: 'Entrevistas',           kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'validations',        name: 'Validaciones',          kind: 'core',  metered: false, unit: null,        defaultUnitPrice: null },
  { code: 'ai_voice_interview', name: 'Entrevista por voz IA', kind: 'addon', metered: true,  unit: 'minutes',   defaultUnitPrice: 0.15 },
  { code: 'video_interviews',   name: 'Videollamadas',         kind: 'addon', metered: true,  unit: 'minutes',   defaultUnitPrice: 0.02 },
  { code: 'proctoring',         name: 'Proctoring',            kind: 'addon', metered: true,  unit: 'exams',      defaultUnitPrice: 10 },
  { code: 'custom_reports',     name: 'Reportes personalizados',kind: 'addon', metered: false, unit: null,        defaultUnitPrice: null },
] as const;

// Modules included in the base ATS license. Exported so callers that must
// stay in lockstep with this catalog (e.g. org-provisioning's test asserting
// no addon-kind module is ever granted) can import the real list instead of
// hardcoding a duplicate that could drift.
export const ATS_BASE_MODULES: readonly (typeof MODULES)[number]['code'][] = [
  'vacancies', 'candidate_portal', 'ai_screening', 'compliance_matrix',
  'assessments', 'interviews', 'validations',
];

// The module catalog (Module/Plan/PlanModule) is CODE-OWNED source of truth.
// Rows carrying mutable seeded scalars (Module, Plan) overwrite on every re-run
// so the catalog always matches this file; PlanModule has no mutable seeded
// payload (composite key only), so its `update` is a no-op. Contrast with
// `provisionInvu` below, where per-org OrgEntitlement rows are operator-tunable
// and must NOT be clobbered. Wrapped in `$transaction` per .claude/rules/db.md
// (multi-step writes atomic).
const ATS_BASE_PLAN = { name: 'ATS Base', description: 'Licencia base del ATS' };
export async function seedEntitlementCatalog(db: PrismaClient): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const m of MODULES) {
      await tx.module.upsert({ where: { code: m.code }, update: m, create: m });
    }
    await tx.plan.upsert({
      where: { code: 'ats-base' },
      update: ATS_BASE_PLAN,
      create: { code: 'ats-base', ...ATS_BASE_PLAN },
    });
    for (const moduleCode of ATS_BASE_MODULES) {
      await tx.planModule.upsert({
        where: { planCode_moduleCode: { planCode: 'ats-base', moduleCode } },
        update: {},
        create: { planCode: 'ats-base', moduleCode },
      });
    }
  });
}

// Provisions the INVU org (Costa Rica) on the ats-base plan, with the
// ai_voice_interview add-on enabled and ai_screening capped at 5000/mo.
//
// NOTE: `Organization.plan` is a legacy `OrgPlan` enum (trial/starter/
// professional/enterprise) predating the Plan/PlanModule/OrgEntitlement
// catalog seeded above — it is NOT the same "plan" concept as the
// entitlement plan code 'ats-base', which has no corresponding OrgPlan
// value. INVU is provisioned as a paid, non-trial org, so `professional`
// is used here as the closest legacy-enum analog; the real source of
// truth for INVU's module access is the OrgEntitlement rows below.
// Wrapped in `$transaction` per .claude/rules/db.md (multi-step writes atomic).
//
// IMPORTANT — OrgEntitlement `update:` clauses are intentionally EMPTY ({}).
// Unlike the code-owned Module/Plan/PlanModule catalog above, per-org
// OrgEntitlement rows are operator-tunable from the platform-owner console
// (enable/disable a module, change a limit, etc.) after initial provisioning.
// `create:` still establishes INVU's initial contract (plan modules + the
// ai_voice_interview addon) on first run; on re-run an existing row is left
// exactly as the operator left it — re-running this seed must never silently
// revert an operator override (e.g. someone disabling ai_voice_interview or
// changing the ai_screening cap).
export async function provisionInvu(db: PrismaClient): Promise<{ orgId: string }> {
  return db.$transaction(async (tx) => {
    const org = await tx.organization.upsert({
      where: { slug: 'invu' },
      update: {},
      create: { name: 'INVU', slug: 'invu', domain: 'invu.go.cr', plan: OrgPlan.professional },
    });

    const plan = await tx.planModule.findMany({ where: { planCode: 'ats-base' } });
    for (const pm of plan) {
      await tx.orgEntitlement.upsert({
        where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: pm.moduleCode } },
        update: {},
        create: {
          organizationId: org.id, moduleCode: pm.moduleCode, enabled: true, source: 'plan',
          limit: pm.moduleCode === 'ai_screening' ? 5000 : pm.limit,
        },
      });
    }

    await tx.orgEntitlement.upsert({
      where: { organizationId_moduleCode: { organizationId: org.id, moduleCode: 'ai_voice_interview' } },
      update: {},
      create: { organizationId: org.id, moduleCode: 'ai_voice_interview', enabled: true, source: 'addon', unitPrice: 0.15 },
    });

    return { orgId: org.id };
  });
}
