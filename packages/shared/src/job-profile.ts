import { z } from 'zod';
import {
  COMPETENCY_CODE_MAX,
  COMPETENCY_DESCRIPTION_MAX,
  COMPETENCY_SCALE_MAX_LIMIT,
  DEFAULT_COMPETENCY_IDS,
  DEFAULT_COMPETENCY_SCALE_MAX,
  MAX_COMPETENCIES,
  parseProfileCompetencies,
} from './interview-scorecard';
import { EVAL360_COMPETENCIES } from './constants/eval360';

// ---------------------------------------------------------------------------
// The vacancy's job profile ("perfil del puesto") — ONE definition of its competencies for every
// side that reads or writes them:
//
//   writers  vacancy.create (wizard), vacancy.update (edit drawer), vacancy.updateJobProfile
//            → jobProfileCompetenciesInputSchema, stored via toStoredCompetencies in job_profiles.competencies
//   readers  the interview room scorecard + submitScorecard (resolveCompetencies), the AI interview guide,
//            and readJobProfile() below — all through parseProfileCompetencies (interview-scorecard.ts)
//   public   the careers page gets competency NAMES only (publicCompetencyNames): target levels and
//            descriptions are internal evaluation criteria.
//
// Stored item: { name, level, scaleMax, code?, description? }
//   - level/scaleMax: the target level is stored WITH its scale (default 5, the scorecard's stars), so a
//     catalog on another scale (e.g. 1-4) can be adopted without migrating stored rows.
//   - code: an optional reference into a competency catalog; null/absent = a custom, free-text competency.
//     Codes are opaque and namespaced by their catalog ("builtin:leadership"). The only catalog in this
//     repository is the generic built-in one below. Licensed frameworks (e.g. a partner's competency
//     dictionary) are NOT part of this public codebase: they plug in as another CompetencyCatalog served
//     at runtime by the platform API, under their own code namespace.
//
// readJobProfile() is the seam for the future assessment gap analysis (personality / cognitive results vs
// the job's expected profile → suggested interview questions): competencies with code + target level +
// scale, and the profile's PCA/MIL expectations, parsed and typed. It contains no assessment content
// (items, norms or scoring keys) and must not grow any.
// Pure: no DB, no I/O, no clock.
// ---------------------------------------------------------------------------

export const COMPETENCY_NAME_MAX = 100;
/** Guidance shown to recruiters, never enforced: a vacancy can have none (the scorecard falls back). */
export const RECOMMENDED_COMPETENCY_COUNT = { min: 3, max: 10 } as const;

/** Case-, accent- and whitespace-insensitive identity of a competency name (duplicate detection). */
export function competencyNameKey(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const competencyCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(COMPETENCY_CODE_MAX)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);

export const jobProfileCompetencyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(COMPETENCY_NAME_MAX),
    description: z.string().trim().max(COMPETENCY_DESCRIPTION_MAX).optional(),
    level: z.number().int().min(1).max(COMPETENCY_SCALE_MAX_LIMIT),
    scaleMax: z.number().int().min(2).max(COMPETENCY_SCALE_MAX_LIMIT).optional(),
    code: competencyCodeSchema.nullish(),
  })
  .refine((c) => c.level <= (c.scaleMax ?? DEFAULT_COMPETENCY_SCALE_MAX), {
    message: 'El nivel supera la escala',
    path: ['level'],
  });

/**
 * The competencies of one job profile, in the order the recruiter set (the scorecard shows that order).
 * Two names that differ only in case, accents or spacing are refused (they would be rated as two
 * separate competencies), and so is the same catalog entry twice.
 */
export const jobProfileCompetenciesInputSchema = z
  .array(jobProfileCompetencyInputSchema)
  .max(MAX_COMPETENCIES)
  .superRefine((items, ctx) => {
    const names = new Set<string>();
    const codes = new Set<string>();
    items.forEach((item, index) => {
      const name = competencyNameKey(item.name);
      if (names.has(name)) ctx.addIssue({ code: 'custom', path: [index, 'name'], message: 'Competencia duplicada' });
      names.add(name);
      if (item.code) {
        if (codes.has(item.code))
          ctx.addIssue({ code: 'custom', path: [index, 'code'], message: 'Competencia duplicada' });
        codes.add(item.code);
      }
    });
  });

export type JobProfileCompetencyInput = z.infer<typeof jobProfileCompetencyInputSchema>;

/** The stored Json shape (a `type`, so it is assignable to Prisma's InputJsonValue). */
export type StoredJobProfileCompetency = {
  name: string;
  level: number;
  scaleMax: number;
  code?: string;
  description?: string;
};

/** Always stores the scale explicitly; empty optional fields are left out rather than stored as "". */
export function toStoredCompetencies(items: readonly JobProfileCompetencyInput[]): StoredJobProfileCompetency[] {
  return items.map((c) => ({
    name: c.name,
    level: c.level,
    scaleMax: c.scaleMax ?? DEFAULT_COMPETENCY_SCALE_MAX,
    ...(c.code ? { code: c.code } : {}),
    ...(c.description ? { description: c.description } : {}),
  }));
}

// ── Catalogs (pluggable) ────────────────────────────────────────────────────

/** One pickable competency of a catalog. Names/descriptions of the built-in entries come from i18n. */
export type CompetencyCatalogEntry = {
  /** Namespaced, stable reference stored as the competency's `code`. */
  code: string;
  name: string;
  description: string | null;
  /** The scale this catalog's target levels use. */
  scaleMax: number;
};

/** A source of pickable competencies: the built-in generic set today; an org or licensed catalog later. */
export type CompetencyCatalog = {
  /** Code namespace of the catalog, e.g. "builtin". */
  id: string;
  entries: readonly CompetencyCatalogEntry[];
};

export const BUILTIN_COMPETENCY_CATALOG_ID = 'builtin';

/**
 * The generic competencies the product already uses (the scorecard's default set plus the 360 set),
 * de-duplicated, as built-in catalog codes. Labels and descriptions live in the web app's i18n.
 */
export const BUILTIN_COMPETENCY_IDS: readonly string[] = [
  ...new Set<string>([...DEFAULT_COMPETENCY_IDS, ...EVAL360_COMPETENCIES]),
];

export function builtinCompetencyCode(id: string): string {
  return `${BUILTIN_COMPETENCY_CATALOG_ID}:${id}`;
}

// ── Read side ───────────────────────────────────────────────────────────────

export interface JobProfileCompetency {
  /** The key a scorecard rating is stored under (ratingKeyFor(name)). */
  key: string;
  name: string;
  description: string | null;
  /** Catalog reference (what a gap analysis matches results on), or null for a custom competency. */
  code: string | null;
  /** Expected level on 1..scaleMax; null for a legacy row stored without one. */
  targetLevel: number | null;
  scaleMax: number;
}

const rangeSchema = z.object({ min: z.number().min(0).max(100), max: z.number().min(0).max(100) });
const discRangesSchema = z.object({
  dominance: rangeSchema.optional(),
  influence: rangeSchema.optional(),
  steadiness: rangeSchema.optional(),
  compliance: rangeSchema.optional(),
});
const milExpectedSchema = z.object({ minScore: z.number().min(0).max(100) });

export type DiscRanges = z.infer<typeof discRangesSchema>;

export interface JobProfileView {
  /**
   * False when the profile defines no (readable) competencies: the scorecard then rates the generic
   * DEFAULT_COMPETENCY_IDS, and a gap analysis has nothing job-specific to compare against.
   */
  hasCompetencies: boolean;
  competencies: JobProfileCompetency[];
  /** Expected PCA (DISC) ranges per dimension, 0..100, when the profile sets them (today one range set). */
  pcaExpected: DiscRanges | null;
  /** Minimum MIL score, 0..100, when the profile sets it. */
  milExpected: { minScore: number } | null;
}

export interface JobProfileSource {
  competencies?: unknown;
  pcaExpected?: unknown;
  milExpected?: unknown;
}

/**
 * Typed view of a vacancy's job profile (raw `job_profiles` columns in, nothing assumed about them).
 * The competency set is EXACTLY the one the interview scorecard rates (same parser, same keys).
 */
export function readJobProfile(raw: JobProfileSource | null | undefined): JobProfileView {
  const competencies = parseProfileCompetencies(raw?.competencies).map((c) => ({
    key: c.key,
    name: c.name,
    description: c.description,
    code: c.code,
    targetLevel: c.level,
    scaleMax: c.scaleMax,
  }));
  const pca = discRangesSchema.safeParse(raw?.pcaExpected);
  const mil = milExpectedSchema.safeParse(raw?.milExpected);
  return {
    hasCompetencies: competencies.length > 0,
    competencies,
    pcaExpected: pca.success && Object.keys(pca.data).length > 0 ? pca.data : null,
    milExpected: mil.success ? mil.data : null,
  };
}

/**
 * What the anonymous careers page may show of the competencies: their names. Target levels, scales,
 * codes and descriptions are the evaluation rubric and never leave the staff side. Legacy rows that stored
 * plain strings keep working; anything else is dropped.
 */
export function publicCompetencyNames(raw: unknown): Array<{ name: string }> {
  if (!Array.isArray(raw)) return [];
  const names: Array<{ name: string }> = [];
  for (const item of raw.slice(0, MAX_COMPETENCIES)) {
    const value =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && !Array.isArray(item)
          ? (item as Record<string, unknown>).name
          : undefined;
    if (typeof value !== 'string') continue;
    const name = value.trim().slice(0, COMPETENCY_NAME_MAX);
    if (name) names.push({ name });
  }
  return names;
}
