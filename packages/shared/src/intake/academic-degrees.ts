/**
 * Academic degrees, lowest to highest (WP-26). The order is the comparison used for a vacancy's
 * minimum-degree requirement, in TS and in the C# mirror.
 */
export const ACADEMIC_DEGREES = [
  'secundaria',
  'tecnico',
  'diplomado',
  'bachillerato_universitario',
  'licenciatura',
  'especialidad',
  'maestria',
  'doctorado',
] as const;
export type AcademicDegree = (typeof ACADEMIC_DEGREES)[number];

/** 1-based rank of a degree; higher is more advanced. */
export function degreeRank(code: AcademicDegree): number {
  return ACADEMIC_DEGREES.indexOf(code) + 1;
}

export function isAcademicDegree(value: string): value is AcademicDegree {
  return (ACADEMIC_DEGREES as readonly string[]).includes(value);
}
