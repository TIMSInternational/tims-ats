// Pure mapping: pipeline stage -> suggested next action (Sprint 1.3 Task 2).
//
// Powers the proactive "what should I do now" toast shown after a successful
// stage move (apps/web/app/(admin)/recruitment/pipeline/page.tsx). This is
// deliberately HEURISTIC, not exhaustive: `PipelineStage.name` is fully
// org-configurable (see packages/db/prisma/schema/pipeline.prisma - the model
// has NO `stageType`/`type` column, verified before writing this file), so an
// org can rename or replace any of the canonical stages. Matching is therefore
// case- and accent-insensitive exact matching against the spec's canonical
// Spanish stage sequence (Postulado -> Preseleccion -> Evaluaciones ->
// Entrevistas -> Oferta -> Contratado), never a hard schema/enum lookup.
//
// If a future migration adds a real `stageType` column to `PipelineStage`,
// prefer matching on that first (it would be authoritative and immune to
// renames) and keep this name-based match only as the fallback for stages
// created before the migration. The optional `stageType` parameter here is
// accepted for that forward-compatible call shape but is currently unused,
// since the column doesn't exist yet.
//
// Unrecognized/custom stage names return `null` - callers MUST fall back to
// today's plain bare toast in that case, never throw and never show a broken
// action link.

export interface NextAction {
  /** Key into `t.pipeline.nextAction` (apps/web/lib/i18n/{es,en}.json). */
  labelKey: 'postulado' | 'preseleccion' | 'evaluaciones' | 'entrevistas' | 'oferta' | 'contratado';
  href: string;
}

// Canonical Spanish stage sequence, normalized (lowercase, no diacritics) ->
// suggested action. Hrefs point at the existing module most relevant to what
// a recruiter would do next in that stage, not at a specific candidate (the
// toast is a general nudge, not a deep link into one application).
const CANONICAL_STAGE_ACTIONS: Record<string, NextAction> = {
  postulado: { labelKey: 'postulado', href: '/recruitment/candidates' },
  preseleccion: { labelKey: 'preseleccion', href: '/recruitment/candidates' },
  evaluaciones: { labelKey: 'evaluaciones', href: '/recruitment/assessments' },
  entrevistas: { labelKey: 'entrevistas', href: '/recruitment/interviews' },
  oferta: { labelKey: 'oferta', href: '/recruitment/offers' },
  contratado: { labelKey: 'contratado', href: '/people/onboarding' },
};

// Matches Unicode combining diacritical marks (U+0300-U+036F) left behind by
// NFD normalization, e.g. turns "e" + combining-acute into plain "e".
const COMBINING_DIACRITICS = /[̀-ͯ]/g;

// Strips accents/diacritics and lowercases, so "Preseleccion" (with accent),
// "preseleccion", "PRESELECCION", and "  Preseleccion  " all normalize the
// same way.
function normalizeStageName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(COMBINING_DIACRITICS, '');
}

export function getNextActionForStage(stageName: string, _stageType?: string | null): NextAction | null {
  if (!stageName) return null;
  const normalized = normalizeStageName(stageName);
  return CANONICAL_STAGE_ACTIONS[normalized] ?? null;
}
