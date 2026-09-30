import { describe, expect, it } from 'vitest';
import { sanitizeSlugInput, slugify, stripDiacritics } from '../../apps/web/lib/slugify';

describe('slugify', () => {
  it('folds Spanish accents instead of dropping the letter', () => {
    expect(slugify('Logística')).toBe('logistica');
    expect(slugify('Logística Andina S.A.S.')).toBe('logistica-andina-s-a-s');
    expect(slugify('Compañía Energética Ñandú')).toBe('compania-energetica-nandu');
    expect(slugify('  Über   Café!! ')).toBe('uber-cafe');
  });

  it('handles precomposed and decomposed input identically', () => {
    expect(slugify('Logística')).toBe('logistica');
    expect(stripDiacritics('Áéíóú')).toBe('Aeiou');
  });

  it('caps the length without leaving a trailing hyphen', () => {
    const slug = slugify(`${'a'.repeat(49)} b`);
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('sanitizeSlugInput', () => {
  it('folds accents while the user types and keeps a trailing hyphen', () => {
    expect(sanitizeSlugInput('Logística-')).toBe('logistica-');
    expect(sanitizeSlugInput('mi empresa')).toBe('mi-empresa');
  });
});
