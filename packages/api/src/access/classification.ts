// packages/api/src/access/classification.ts
//
// Sensitive Data Permission Matrix → code. Source of truth:
// docs/TIMS ATS - Architecture.md §21 (lines 2472-2553).
//
// dataClass ladder (rising sensitivity): public < internal < confidential < restricted.
//   - confidential/restricted reads MUST write a data_access_logs row (see audit.ts).
//   - restricted reads abort if the audit write fails (fail-closed).
// Per-field visibility lists the ROLES that may SELECT that field. Row-scope
// (own/team/assigned) is enforced separately by entity-policies.ts; this layer is
// purely FIELD-level. A field with no role entry is visible to NO ONE (fail-closed).
//
// Only models with a backing Prisma table + an active reader are registered here.
// Matrix rows without a model (Health/Medical, Interview Recordings, Background
// Check, Integrity Test, free-text Coaching Notes) are tracked as follow-ons in
// docs/REMAINING-WORK.md — deliberately NOT faked as registry entries.

export type DataClass = 'public' | 'internal' | 'confidential' | 'restricted';

export const DATA_CLASS_RANK: Record<DataClass, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
};

/** A field is selectable by exactly the roles listed. Empty/absent = no one. */
interface FieldRule {
  dataClass: DataClass;
  roles: readonly string[];
}

interface EntityClassification {
  /** The entity's headline data-class — the MAX of its fields. Drives audit/consent. */
  dataClass: DataClass;
  /** Does any visible read require subject consent? (demographics) */
  consentType?: string;
  fields: Record<string, FieldRule>;
}

// Convenience role bundles (matrix columns).
const SUPER = 'super_admin';
const HR = 'hr_admin';
const HRBP = 'hrbp';
const RECRUITER = 'recruiter';
const LEADER = 'leader';
const EMPLOYEE = 'employee';
// external = API-key integrations (Wave 2.5 slice 7b). On assessmentResult ONLY:
// the analysis-engine consumer reads the full normed psychometric profile (Federico
// Jun 15). Deliberately exceeds human roles on raw fields — see plan + memory.
const EXTERNAL = 'external';

export const CLASSIFICATION: Readonly<Record<string, EntityClassification>> = {
  // Compensation/Salary → restricted. FULL+AUDIT super/hr; READ+AUDIT(assigned) hrbp;
  // OWN TEAM+AUDIT leader; OWN employee; NONE recruiter/candidate.
  // compaRatio/variablePay are HR analytics — never shown to employee/leader.
  employeeCompensation: {
    dataClass: 'restricted',
    fields: {
      currentSalary: { dataClass: 'restricted', roles: [SUPER, HR, HRBP, LEADER, EMPLOYEE] },
      currency: { dataClass: 'restricted', roles: [SUPER, HR, HRBP, LEADER, EMPLOYEE] },
      effectiveDate: { dataClass: 'restricted', roles: [SUPER, HR, HRBP, LEADER, EMPLOYEE] },
      compaRatio: { dataClass: 'restricted', roles: [SUPER, HR, HRBP] },
      variablePay: { dataClass: 'restricted', roles: [SUPER, HR, HRBP] },
      bandId: { dataClass: 'restricted', roles: [SUPER, HR, HRBP] },
    },
  },

  salaryAdjustment: {
    dataClass: 'restricted',
    fields: {
      previousSalary: { dataClass: 'restricted', roles: [SUPER, HR] },
      newSalary: { dataClass: 'restricted', roles: [SUPER, HR] },
      reason: { dataClass: 'restricted', roles: [SUPER, HR] },
      type: { dataClass: 'confidential', roles: [SUPER, HR, HRBP] },
      status: { dataClass: 'internal', roles: [SUPER, HR, HRBP, LEADER, EMPLOYEE] },
    },
  },

  // AssessmentResult — two classes in one table:
  //   raw (breakdown/rawScore) = restricted, super_admin ONLY (matrix: Psychometric Raw).
  //   scores (normalized/percentile/interpretation) = confidential
  //     (super/hr READ+AUDIT; hrbp/recruiter READ+AUDIT assigned; employee OWN summary).
  //   external (API integrations) reads the full profile via the external API surface
  //     (slice 7b) — analysis-engine consumer is second-most-privileged reader, per
  //     Federico Jun 15.
  assessmentResult: {
    dataClass: 'restricted',
    fields: {
      breakdown: { dataClass: 'restricted', roles: [SUPER, EXTERNAL] },
      rawScore: { dataClass: 'restricted', roles: [SUPER, EXTERNAL] },
      normalizedScore: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      percentile: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      interpretation: { dataClass: 'confidential', roles: [SUPER, HR, HRBP, RECRUITER, EMPLOYEE, EXTERNAL] },
      modelVersion: { dataClass: 'internal', roles: [SUPER, HR, EXTERNAL] },
    },
  },

  // DEI Demographics → confidential. FULL+AUDIT super; AGGREGATE hr/hrbp (no per-person
  // field reads below super — enforced by callers using aggregate.ts, not by listing
  // hr here); OWN+CONSENT employee/candidate; NONE recruiter/leader. Per-person field
  // selection is super_admin only; everyone else goes through aggregate counts.
  employeeDemographics: {
    dataClass: 'confidential',
    consentType: 'dei_demographics',
    fields: {
      gender: { dataClass: 'confidential', roles: [SUPER] },
      ethnicity: { dataClass: 'confidential', roles: [SUPER] },
      disabilityStatus: { dataClass: 'confidential', roles: [SUPER] },
      dateOfBirth: { dataClass: 'confidential', roles: [SUPER] },
      nationality: { dataClass: 'confidential', roles: [SUPER] },
    },
  },

  // Engagement Responses (individual) → confidential. FULL+AUDIT super; AGGREGATE
  // everyone else. Per-row answers are super_admin only; the rest read via aggregate.ts.
  surveyResponse: {
    dataClass: 'confidential',
    fields: {
      answers: { dataClass: 'confidential', roles: [SUPER] },
    },
  },
};

/**
 * The entity's headline data-class (drives audit/consent decisions).
 * Defaults to 'internal' (not 'public') for unknown entities — unknown ≠ safe.
 */
export function dataClassOf(entity: string): DataClass {
  return CLASSIFICATION[entity]?.dataClass ?? 'internal';
}

/**
 * Fields the given roles may SELECT for an entity. Fail-closed UNION: a field is
 * included iff AT LEAST ONE role grants it (consistent with scope stacking).
 * Unknown entity or no matching roles → []. Order is registry-declaration order.
 */
export function fieldsVisibleTo(roles: string[], entity: string): string[] {
  const cls = CLASSIFICATION[entity];
  if (!cls) return [];
  const roleSet = new Set(roles);
  return Object.entries(cls.fields)
    .filter(([, rule]) => rule.roles.some((r) => roleSet.has(r)))
    .map(([field]) => field);
}
