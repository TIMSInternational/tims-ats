import { describe, it, expect } from 'vitest';
import {
  parseSurveyQuestions,
  type SurveyQuestion,
} from '../../apps/web/app/(admin)/dashboard/survey-question';

// Behavioral tests for the tolerant, normalizing survey-question parser.
//
// The take-form modal (PR #90) opened EMPTY for real surveys because the old
// parser used an all-or-nothing `z.array(schema).safeParse` whose enum only
// accepted the AUTHORING shape (scale/text/multiple_choice/yes_no). The actual
// STORED shape (seed-demo.ts) uses a different vocabulary — `open_text`, `nps`,
// and `min`/`max`/`id` fields — so one unrecognized question rejected the whole
// array → [] → the modal showed its empty state for a populated survey.
//
// The parser must now be PER-QUESTION tolerant and accept BOTH shapes,
// normalizing to one renderable union the field component consumes. Fixtures
// below are copied from the ACTUAL seed shapes (packages/db/prisma/seed-demo.ts
// ~1162-1198) plus the authoring shape (createSurvey Zod in engagement.ts).

// --- Fixtures copied from the REAL stored shapes (seed-demo.ts) ---

// "Encuesta de Onboarding" (status active) — the survey that rendered empty.
const SEED_ONBOARDING: unknown = [
  { id: 'q1', text: 'El proceso de onboarding cumplio mis expectativas', type: 'scale', min: 1, max: 5 },
  { id: 'q2', text: 'Mi buddy fue util durante mis primeros dias', type: 'scale', min: 1, max: 5 },
  { id: 'q3', text: 'Sugerencias de mejora', type: 'open_text' },
];

// "Encuesta de Clima Organizacional" — includes an `nps` question.
const SEED_CLIMATE: unknown = [
  { id: 'q1', text: 'Me siento valorado en mi equipo', type: 'scale', min: 1, max: 5 },
  { id: 'q2', text: 'Tengo las herramientas necesarias para hacer mi trabajo', type: 'scale', min: 1, max: 5 },
  { id: 'q3', text: 'Mi lider me da feedback regularmente', type: 'scale', min: 1, max: 5 },
  { id: 'q4', text: 'Recomendaria esta empresa como lugar de trabajo', type: 'nps', min: 0, max: 10 },
  { id: 'q5', text: 'Comentarios adicionales', type: 'open_text' },
];

// Authoring shape produced by createSurvey's Zod.
const AUTHORING_MC: unknown = [
  { text: 'Que tan satisfecho estas?', type: 'multiple_choice', options: ['a', 'b'], required: true },
];

describe('parseSurveyQuestions — accepts the STORED seed shape (the empty-render bug)', () => {
  it('yields 3 renderable questions for "Encuesta de Onboarding" (2 scale + 1 text), NOT []', () => {
    const result = parseSurveyQuestions(SEED_ONBOARDING);
    expect(result).toHaveLength(3);
    expect(result.map((q) => q.kind)).toEqual(['scale', 'scale', 'text']);
  });

  it('maps `scale` with min/max to a numeric scale (number answer) respecting the range', () => {
    const [first] = parseSurveyQuestions(SEED_ONBOARDING);
    expect(first.kind).toBe('scale');
    if (first.kind === 'scale') {
      expect(first.min).toBe(1);
      expect(first.max).toBe(5);
    }
    expect(first.text).toBe('El proceso de onboarding cumplio mis expectativas');
    expect(first.required).toBe(true);
  });

  it('maps `open_text` to a text question (string answer)', () => {
    const result = parseSurveyQuestions(SEED_ONBOARDING);
    const last = result[2];
    expect(last.kind).toBe('text');
    expect(last.text).toBe('Sugerencias de mejora');
  });

  it('maps `nps` to a 0..10 numeric scale', () => {
    const result = parseSurveyQuestions(SEED_CLIMATE);
    expect(result).toHaveLength(5);
    const nps = result.find((q) => q.text === 'Recomendaria esta empresa como lugar de trabajo');
    expect(nps?.kind).toBe('scale');
    if (nps?.kind === 'scale') {
      expect(nps.min).toBe(0);
      expect(nps.max).toBe(10);
    }
  });

  it('defaults a `scale` with no min/max to 1..5', () => {
    const result = parseSurveyQuestions([{ text: 'sin rango', type: 'scale' }]);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'scale') {
      expect(result[0].min).toBe(1);
      expect(result[0].max).toBe(5);
    }
  });

  it('defaults an `nps` with no min/max to 0..10', () => {
    const result = parseSurveyQuestions([{ text: 'sin rango', type: 'nps' }]);
    expect(result).toHaveLength(1);
    if (result[0].kind === 'scale') {
      expect(result[0].min).toBe(0);
      expect(result[0].max).toBe(10);
    }
  });
});

describe('parseSurveyQuestions — still accepts the AUTHORING shape', () => {
  it('maps `multiple_choice` with options to a choice question (string answer)', () => {
    const result = parseSurveyQuestions(AUTHORING_MC);
    expect(result).toHaveLength(1);
    const q = result[0];
    expect(q.kind).toBe('choice');
    if (q.kind === 'choice') {
      expect(q.options).toEqual(['a', 'b']);
    }
    expect(q.required).toBe(true);
  });

  it('maps `text` (authoring) to a text question', () => {
    const result = parseSurveyQuestions([{ text: 'comentario', type: 'text' }]);
    expect(result[0].kind).toBe('text');
  });

  it('maps `yes_no` to a yes/no question (string answer)', () => {
    const result = parseSurveyQuestions([{ text: 'tienes bloqueos?', type: 'yes_no' }]);
    expect(result[0].kind).toBe('yes_no');
  });

  it('drops a multiple_choice with no usable options', () => {
    const result = parseSurveyQuestions([{ text: 'sin opciones', type: 'multiple_choice', options: [] }]);
    expect(result).toHaveLength(0);
  });
});

describe('parseSurveyQuestions — per-question tolerance (never all-or-nothing)', () => {
  it('drops only the garbage element and keeps the valid ones', () => {
    const mixed: unknown = [
      { id: 'q1', text: 'valida 1', type: 'scale', min: 1, max: 5 },
      { type: 'scale', min: 1, max: 5 }, // missing `text` → dropped
      { id: 'q3', text: 'tipo desconocido', type: 'emoji', options: ['a'] }, // unmappable type → dropped
      { id: 'q4', text: 'valida 2', type: 'open_text' },
      'not-an-object', // → dropped
      null, // → dropped
    ];
    const result = parseSurveyQuestions(mixed);
    expect(result.map((q) => q.text)).toEqual(['valida 1', 'valida 2']);
  });

  it('drops an element missing `text`', () => {
    expect(parseSurveyQuestions([{ type: 'scale', min: 1, max: 5 }])).toHaveLength(0);
  });

  it('drops an element with an unmappable `type`', () => {
    expect(parseSurveyQuestions([{ text: 'x', type: 'emoji' }])).toHaveLength(0);
  });

  it('defaults `required` to true when absent', () => {
    const [q] = parseSurveyQuestions([{ text: 'x', type: 'open_text' }]);
    expect(q.required).toBe(true);
  });

  it('honors an explicit required:false', () => {
    const [q] = parseSurveyQuestions([{ text: 'x', type: 'open_text', required: false }]);
    expect(q.required).toBe(false);
  });
});

describe('parseSurveyQuestions — non-array / non-object input → []', () => {
  it('returns [] for null', () => {
    expect(parseSurveyQuestions(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseSurveyQuestions(undefined)).toEqual([]);
  });

  it('returns [] for a non-array object', () => {
    expect(parseSurveyQuestions({ text: 'x', type: 'scale' })).toEqual([]);
  });

  it('returns [] for a string', () => {
    expect(parseSurveyQuestions('questions')).toEqual([]);
  });

  it('returns [] for a number', () => {
    expect(parseSurveyQuestions(42)).toEqual([]);
  });
});

describe('SurveyQuestion type — answer-value union stays string | number', () => {
  it('scale/nps carry a numeric range; text/choice/yes_no carry no range', () => {
    // Type-level assertion exercised at runtime: a scale question's range is numeric.
    const result: SurveyQuestion[] = parseSurveyQuestions(SEED_CLIMATE);
    for (const q of result) {
      if (q.kind === 'scale') {
        expect(typeof q.min).toBe('number');
        expect(typeof q.max).toBe('number');
      }
    }
  });
});
