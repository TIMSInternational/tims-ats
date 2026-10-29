/**
 * identity-number.test.ts — WP-26 PR-2 (candidate-spec-43, candidate-ideal-77).
 *
 * The apply flow has no identity-number field and nothing validates one. These tests pin the shared rules
 * the apply step (PR-6), the D-1 input (PR-5) and the C# mirror (PR-4) will all use, driven by the golden
 * contracts/invu-intake/identity-cases.json so the two stacks cannot drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  IDENTITY_NUMBER_TYPES,
  normalizeIdentityNumber,
  validateIdentityNumber,
  maskIdentityNumber,
} from '@tims/shared';

interface IdentityCase {
  name: string;
  type: 'cedula_fisica' | 'dimex' | 'pasaporte';
  raw: string;
  expected: { result: 'ok' | 'invalid_format'; normalized?: string };
}
interface MaskCase {
  name: string;
  input: string;
  expected: string;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, '..', '..', 'contracts', 'invu-intake', 'identity-cases.json'), 'utf8'),
) as { cases: IdentityCase[]; maskCases: MaskCase[] };

describe('identity number types', () => {
  it('lists exactly cedula fisica, DIMEX and pasaporte (no cedula juridica)', () => {
    expect([...IDENTITY_NUMBER_TYPES]).toEqual(['cedula_fisica', 'dimex', 'pasaporte']);
  });
});

describe('validateIdentityNumber — golden cases', () => {
  it('has a meaningful fixture', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(15);
  });

  for (const c of fixture.cases) {
    it(c.name, () => {
      expect(validateIdentityNumber(c.type, c.raw)).toBe(c.expected.result);
      if (c.expected.normalized !== undefined) {
        expect(normalizeIdentityNumber(c.type, c.raw)).toBe(c.expected.normalized);
      }
    });
  }
});

describe('validateIdentityNumber — unknown runtime types', () => {
  it('rejects a type named after an inherited object property instead of throwing', () => {
    for (const type of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'cedula_juridica']) {
      const unknownType = type as Parameters<typeof validateIdentityNumber>[0];
      expect(validateIdentityNumber(unknownType, '123456789')).toBe('invalid_format');
    }
  });
});

describe('normalizeIdentityNumber', () => {
  it('strips spaces and dashes', () => {
    expect(normalizeIdentityNumber('cedula_fisica', ' 1-2345 6789 ')).toBe('123456789');
  });
});

describe('maskIdentityNumber — golden cases', () => {
  for (const c of fixture.maskCases) {
    it(c.name, () => {
      const masked = maskIdentityNumber(c.input);
      expect(masked).toBe(c.expected);
      expect(masked).not.toContain(c.input.slice(0, 5));
    });
  }
});
