/**
 * intake-content-type.test.ts — WP-26 PR-2 (candidate-spec-43).
 *
 * The only upload today is a CV restricted to PDF/DOCX. Intake documents (títulos, constancias, ID scans)
 * arrive as PDF or phone photos, and HEIC photos often come with an empty browser type. The content type
 * is resolved from the extension and a conflicting browser type is refused rather than trusted.
 */
import { describe, it, expect } from 'vitest';
import { INTAKE_ALLOWED_CONTENT_TYPES, resolveIntakeContentType } from '@tims/shared';

describe('INTAKE_ALLOWED_CONTENT_TYPES', () => {
  it('is exactly PDF, JPEG, PNG, HEIC and HEIF', () => {
    expect([...INTAKE_ALLOWED_CONTENT_TYPES].sort()).toEqual(
      ['application/pdf', 'image/heic', 'image/heif', 'image/jpeg', 'image/png'].sort(),
    );
  });
});

describe('resolveIntakeContentType', () => {
  it('resolves a HEIC photo with an empty browser type by its extension (any case)', () => {
    expect(resolveIntakeContentType('foto.HEIC', '')).toBe('image/heic');
  });

  it('resolves a PDF with an empty browser type by its extension', () => {
    expect(resolveIntakeContentType('titulo.pdf', '')).toBe('application/pdf');
  });

  it('accepts a matching browser type', () => {
    expect(resolveIntakeContentType('a.pdf', 'application/pdf')).toBe('application/pdf');
    expect(resolveIntakeContentType('a.jpg', 'image/jpeg')).toBe('image/jpeg');
    expect(resolveIntakeContentType('a.png', 'image/png')).toBe('image/png');
  });

  it('rejects a browser type that contradicts the extension', () => {
    expect(resolveIntakeContentType('a.pdf', 'image/png')).toBeNull();
    expect(resolveIntakeContentType('a.png', 'application/pdf')).toBeNull();
  });

  it('rejects extensions outside the allow-list even when the browser claims an allowed type', () => {
    expect(resolveIntakeContentType('a.exe', 'application/pdf')).toBeNull();
    expect(resolveIntakeContentType('a.docx', '')).toBeNull();
    expect(resolveIntakeContentType('a.html', 'text/html')).toBeNull();
  });

  it('rejects a file name without an extension', () => {
    expect(resolveIntakeContentType('documento', 'application/pdf')).toBeNull();
  });

  it('uses only the last extension', () => {
    expect(resolveIntakeContentType('a.pdf.exe', '')).toBeNull();
  });
});
