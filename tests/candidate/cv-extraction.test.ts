// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { extractCvText, CV_ALLOWED_CONTENT_TYPES } from '../../packages/api/src/lib/cv-extraction';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractCvText', () => {
  it('extracts text from a PDF via pdf-parse', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'PDF resume text' } as never);
    const buffer = Buffer.from('fake-pdf-bytes');

    const text = await extractCvText(buffer, 'application/pdf');

    expect(pdfParse).toHaveBeenCalledWith(buffer);
    expect(text).toBe('PDF resume text');
  });

  it('extracts text from a DOCX via mammoth', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'DOCX resume text' } as never);
    const buffer = Buffer.from('fake-docx-bytes');

    const text = await extractCvText(
      buffer,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer });
    expect(text).toBe('DOCX resume text');
  });

  it('propagates a thrown error from the underlying PDF parser', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('corrupt PDF'));
    const buffer = Buffer.from('garbage');

    await expect(extractCvText(buffer, 'application/pdf')).rejects.toThrow('corrupt PDF');
  });

  it('throws for an unsupported content type', async () => {
    const buffer = Buffer.from('irrelevant');

    // @ts-expect-error — intentionally passing an unsupported content type
    await expect(extractCvText(buffer, 'image/png')).rejects.toThrow('Unsupported CV content type');
  });

  it('exposes exactly the two supported content types', () => {
    expect(CV_ALLOWED_CONTENT_TYPES).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });
});
