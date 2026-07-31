import { describe, it, expect } from 'vitest';
import { extractCvText, CV_ALLOWED_CONTENT_TYPES } from '../../packages/api/src/lib/cv-extraction';

describe('extractCvText', () => {
  it('exposes exactly the two supported content types', () => {
    expect(CV_ALLOWED_CONTENT_TYPES).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  it('throws for an unsupported content type', async () => {
    const buffer = Buffer.from('irrelevant');

    // @ts-expect-error — intentionally passing an unsupported content type
    await expect(extractCvText(buffer, 'image/png')).rejects.toThrow('Unsupported CV content type: image/png');
  });

  it('propagates errors from pdf-parse when parsing fails', async () => {
    const invalidPdfBuffer = Buffer.from('This is not a PDF');

    await expect(extractCvText(invalidPdfBuffer, 'application/pdf')).rejects.toThrow();
  });

  it('propagates errors from mammoth when parsing fails', async () => {
    const invalidDocxBuffer = Buffer.from('This is not a DOCX file');

    await expect(
      extractCvText(invalidDocxBuffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ).rejects.toThrow();
  });
});
