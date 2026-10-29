/**
 * intake-schemas.test.ts — WP-26 PR-2 (candidate-spec-43, candidate-ideal-77).
 *
 * The apply input today is a single optional CV key: no documents, identity number, academic degree,
 * professional college, years or declaration. intakeSubmissionSchema is the one bounded, strict shape the web
 * payload (PR-6) and the D-1 apply input (PR-5) share. The enums it relies on are pinned here too.
 */
import { describe, it, expect } from 'vitest';
import {
  intakeSubmissionSchema,
  INTAKE_DOCUMENT_TYPES,
  INVU_PASO1_TEMPLATE,
  MAX_REQUIREMENTS_PER_VACANCY,
  MAX_FILES_PER_REQUIREMENT,
  INTAKE_MAX_BYTES,
  ACADEMIC_DEGREES,
  degreeRank,
  CR_PROFESSIONAL_COLLEGES,
} from '@tims/shared';

const ORG = '11111111-1111-4111-8111-111111111111';
const VAC = '33333333-3333-4333-8333-333333333333';
const REQ = '44444444-4444-4444-8444-444444444444';
const FILE = '55555555-5555-4555-8555-555555555555';

const document = (overrides: Record<string, unknown> = {}) => ({
  objectKey: `candidate-docs/${ORG}/${VAC}/${REQ}/${FILE}.pdf`,
  fileName: 'titulo.pdf',
  contentType: 'application/pdf',
  ...overrides,
});

const valid = () => ({
  identity: { type: 'cedula_fisica', number: '1-2345-6789' },
  academicDegree: 'licenciatura',
  professionalCollege: 'Colegio de Ejemplo',
  collegeLicense: 'A-1234',
  relevantYears: 5,
  declaration: { textVersion: 'invu-decl-v0', locale: 'es' },
  documents: [document()],
});

const parses = (input: unknown) => intakeSubmissionSchema.safeParse(input).success;

describe('intakeSubmissionSchema — accepts', () => {
  it('a complete submission', () => {
    expect(parses(valid())).toBe(true);
  });

  it('a submission with only an empty document list', () => {
    expect(parses({ documents: [] })).toBe(true);
  });

  it('exactly 100 documents', () => {
    expect(parses({ ...valid(), documents: Array.from({ length: 100 }, () => document()) })).toBe(true);
  });

  it('a 255-character file name', () => {
    expect(parses({ ...valid(), documents: [document({ fileName: `${'a'.repeat(251)}.pdf` })] })).toBe(true);
  });

  it('relevantYears at the bounds 0 and 60', () => {
    expect(parses({ ...valid(), relevantYears: 0 })).toBe(true);
    expect(parses({ ...valid(), relevantYears: 60 })).toBe(true);
  });
});

describe('intakeSubmissionSchema — strict', () => {
  it('rejects an unknown top-level key', () => {
    expect(parses({ ...valid(), isAdmin: true })).toBe(false);
  });

  it('rejects an unknown key inside identity', () => {
    expect(parses({ ...valid(), identity: { type: 'dimex', number: '15520012345', verified: true } })).toBe(false);
  });

  it('rejects an unknown key inside declaration', () => {
    expect(parses({ ...valid(), declaration: { textVersion: 'invu-decl-v0', locale: 'es', declaredAt: 'x' } })).toBe(
      false,
    );
  });

  it('rejects an unknown key inside a document', () => {
    expect(parses({ ...valid(), documents: [document({ status: 'accepted' })] })).toBe(false);
  });
});

describe('intakeSubmissionSchema — bounds', () => {
  it('rejects 101 documents', () => {
    expect(parses({ ...valid(), documents: Array.from({ length: 101 }, () => document()) })).toBe(false);
  });

  it('rejects a missing document list', () => {
    const { documents: _omit, ...rest } = valid();
    expect(parses(rest)).toBe(false);
  });

  it('rejects a 256-character file name and an empty one', () => {
    expect(parses({ ...valid(), documents: [document({ fileName: `${'a'.repeat(252)}.pdf` })] })).toBe(false);
    expect(parses({ ...valid(), documents: [document({ fileName: '' })] })).toBe(false);
  });

  it('rejects an object key over 300 characters', () => {
    expect(parses({ ...valid(), documents: [document({ objectKey: 'k'.repeat(301) })] })).toBe(false);
  });

  it('rejects a content type outside the allow-list', () => {
    expect(parses({ ...valid(), documents: [document({ contentType: 'text/html' })] })).toBe(false);
  });

  it('rejects a professional college over 120 and a licence over 40 characters', () => {
    expect(parses({ ...valid(), professionalCollege: 'c'.repeat(121) })).toBe(false);
    expect(parses({ ...valid(), collegeLicense: 'l'.repeat(41) })).toBe(false);
  });

  it('rejects relevantYears outside 0..60', () => {
    expect(parses({ ...valid(), relevantYears: -1 })).toBe(false);
    expect(parses({ ...valid(), relevantYears: 61 })).toBe(false);
  });

  it('rejects an unknown academic degree', () => {
    expect(parses({ ...valid(), academicDegree: 'phd' })).toBe(false);
  });

  it('rejects an unknown identity type and an unbounded identity number', () => {
    expect(parses({ ...valid(), identity: { type: 'cedula_juridica', number: '3101123456' } })).toBe(false);
    expect(parses({ ...valid(), identity: { type: 'pasaporte', number: 'A'.repeat(100) } })).toBe(false);
  });

  it('rejects an unknown declaration version or locale', () => {
    expect(parses({ ...valid(), declaration: { textVersion: 'invu-decl-v999', locale: 'es' } })).toBe(false);
    expect(parses({ ...valid(), declaration: { textVersion: 'invu-decl-v0', locale: 'fr' } })).toBe(false);
  });
});

describe('intake enums and limits', () => {
  it('document types', () => {
    expect([...INTAKE_DOCUMENT_TYPES]).toEqual([
      'cv',
      'titulo',
      'incorporacion_colegio',
      'constancia_laboral',
      'hoja_delincuencia',
      'identificacion',
      'certificacion',
      'licencia',
      'otro',
    ]);
  });

  it('limits', () => {
    expect(MAX_REQUIREMENTS_PER_VACANCY).toBe(20);
    expect(MAX_FILES_PER_REQUIREMENT).toBe(5);
    expect(INTAKE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('academic degrees are ordered and degreeRank is strictly increasing', () => {
    expect([...ACADEMIC_DEGREES]).toEqual([
      'secundaria',
      'tecnico',
      'diplomado',
      'bachillerato_universitario',
      'licenciatura',
      'especialidad',
      'maestria',
      'doctorado',
    ]);
    for (let i = 1; i < ACADEMIC_DEGREES.length; i++) {
      expect(degreeRank(ACADEMIC_DEGREES[i])).toBeGreaterThan(degreeRank(ACADEMIC_DEGREES[i - 1]));
    }
  });

  it('the Paso 1 template has the five document requirements, a declaration and a minimum degree', () => {
    const docs = INVU_PASO1_TEMPLATE.filter((r) => r.kind === 'document').map((r) => r.documentType);
    expect(docs).toEqual(['cv', 'titulo', 'incorporacion_colegio', 'constancia_laboral', 'hoja_delincuencia']);
    expect(INVU_PASO1_TEMPLATE.filter((r) => r.kind === 'declaration')).toHaveLength(1);
    expect(INVU_PASO1_TEMPLATE.filter((r) => r.kind === 'min_academic_degree')).toHaveLength(1);
    expect(INVU_PASO1_TEMPLATE.length).toBeLessThanOrEqual(MAX_REQUIREMENTS_PER_VACANCY);
  });

  it('professional college suggestions are unique and fit the 120-character field', () => {
    expect(CR_PROFESSIONAL_COLLEGES.length).toBeGreaterThan(0);
    expect(new Set(CR_PROFESSIONAL_COLLEGES).size).toBe(CR_PROFESSIONAL_COLLEGES.length);
    for (const name of CR_PROFESSIONAL_COLLEGES) {
      expect(name.trim().length).toBeGreaterThan(0);
      expect(name.length).toBeLessThanOrEqual(120);
    }
  });
});
