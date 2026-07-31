import { describe, it, expect } from 'vitest';
import {
  validateCvFile,
  CV_MAX_BYTES,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/cv-validation';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('validateCvFile', () => {
  it('accepts a PDF under the size cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', 1024);
    expect(validateCvFile(file)).toBeNull();
  });

  it('accepts a DOCX under the size cap', () => {
    const file = makeFile(
      'resume.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      1024,
    );
    expect(validateCvFile(file)).toBeNull();
  });

  it('rejects an unsupported MIME type', () => {
    const file = makeFile('resume.png', 'image/png', 1024);
    expect(validateCvFile(file)).toBe('invalid_type');
  });

  it('rejects a file over the 5MB cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', CV_MAX_BYTES + 1);
    expect(validateCvFile(file)).toBe('too_large');
  });

  it('accepts a file exactly at the size cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', CV_MAX_BYTES);
    expect(validateCvFile(file)).toBeNull();
  });
});
