/**
 * intake-declaration.test.ts — WP-26 PR-2 (candidate-spec-43).
 *
 * There is no declaration of compliance with requirements today. The declaration text is versioned like the
 * application consent: the server stores the version, the locale and a SHA-256 of the exact text shown, so the
 * record always identifies what the candidate agreed to. The hash needs node crypto and is exported only from
 * the shared server entry so the web bundle never pulls `crypto` in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'node:crypto';
import * as shared from '@tims/shared';
import {
  INTAKE_DECLARATION_TEXT_VERSIONS,
  INTAKE_DECLARATION_TEXT_VERSION,
  INTAKE_DECLARATION_TEXT,
  INTAKE_DECLARATION_LOCALES,
} from '@tims/shared';
import { declarationTextSha256 } from '../../packages/shared/src/server';

const SHARED_SRC = join(__dirname, '..', '..', 'packages', 'shared', 'src');

describe('declaration text versions', () => {
  it('the current version is the neutral placeholder and is a known version', () => {
    expect(INTAKE_DECLARATION_TEXT_VERSION).toBe('invu-decl-v0');
    expect(INTAKE_DECLARATION_TEXT_VERSIONS).toContain(INTAKE_DECLARATION_TEXT_VERSION);
  });

  it('versions are unique', () => {
    expect(new Set(INTAKE_DECLARATION_TEXT_VERSIONS).size).toBe(INTAKE_DECLARATION_TEXT_VERSIONS.length);
  });

  it('locales are es and en', () => {
    expect([...INTAKE_DECLARATION_LOCALES]).toEqual(['es', 'en']);
  });

  it('every version has non-empty, distinct es and en canonical texts', () => {
    for (const version of INTAKE_DECLARATION_TEXT_VERSIONS) {
      const texts = INTAKE_DECLARATION_TEXT[version];
      expect(texts.es.trim().length, version).toBeGreaterThan(20);
      expect(texts.en.trim().length, version).toBeGreaterThan(20);
      expect(texts.es).not.toBe(texts.en);
    }
  });
});

describe('declarationTextSha256 (server entry)', () => {
  const v = INTAKE_DECLARATION_TEXT_VERSION;

  it('is a lowercase 64-char hex digest', () => {
    expect(declarationTextSha256(v, 'es')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across calls', () => {
    expect(declarationTextSha256(v, 'es')).toBe(declarationTextSha256(v, 'es'));
    expect(declarationTextSha256(v, 'en')).toBe(declarationTextSha256(v, 'en'));
  });

  it('differs by locale', () => {
    expect(declarationTextSha256(v, 'es')).not.toBe(declarationTextSha256(v, 'en'));
  });

  it('is the SHA-256 of the exact canonical UTF-8 text', () => {
    for (const locale of INTAKE_DECLARATION_LOCALES) {
      const expected = createHash('sha256').update(INTAKE_DECLARATION_TEXT[v][locale], 'utf8').digest('hex');
      expect(declarationTextSha256(v, locale)).toBe(expected);
    }
  });
});

describe('crypto stays out of the client-safe entry', () => {
  it('@tims/shared (index) does not export declarationTextSha256', () => {
    expect((shared as Record<string, unknown>).declarationTextSha256).toBeUndefined();
  });

  it('index.ts does not re-export the server entry', () => {
    const index = readFileSync(join(SHARED_SRC, 'index.ts'), 'utf8');
    expect(index).not.toMatch(/['"]\.\/server['"]/);
  });

  it('no file under src/intake imports crypto', () => {
    const dir = join(SHARED_SRC, 'intake');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"](node:)?crypto['"]|require\(\s*['"](node:)?crypto['"]\s*\)/);
    }
  });
});
