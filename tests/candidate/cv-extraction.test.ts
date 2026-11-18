// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import {
  extractCvText,
  annotatePdfParseError,
  CV_ALLOWED_CONTENT_TYPES,
  PDFJS_BUILD_VERSION,
} from '../../packages/api/src/lib/cv-extraction';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractCvText', () => {
  it('extracts text from a PDF via pdf-parse, pinned to the traced pdf.js build', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'PDF resume text' } as never);
    const buffer = Buffer.from('fake-pdf-bytes');

    const text = await extractCvText(buffer, 'application/pdf');

    expect(PDFJS_BUILD_VERSION).toBe('v1.10.100');
    expect(pdfParse).toHaveBeenCalledWith(expect.any(Uint8Array), { version: PDFJS_BUILD_VERSION });
    expect(text).toBe('PDF resume text');
  });

  it('hands pdf-parse a plain Uint8Array copy at offset 0, never a (possibly pooled) Buffer', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: '' } as never);
    // A small Buffer is a slice of Node's shared pool: nonzero byteOffset into a larger ArrayBuffer.
    const pooled = Buffer.from('%PDF-1.4 small file');

    await extractCvText(pooled, 'application/pdf');

    const [bytes] = vi.mocked(pdfParse).mock.calls[0];
    expect(Buffer.isBuffer(bytes)).toBe(false);
    expect(bytes.constructor).toBe(Uint8Array);
    expect(bytes.byteOffset).toBe(0);
    expect(bytes.buffer.byteLength).toBe(pooled.length);
    expect(Array.from(bytes)).toEqual(Array.from(pooled));
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

  it("names the original error class hidden in pdf.js's UnknownErrorException, never its message", async () => {
    // Shape of pdf.js 1.10's UnknownErrorException: details = original error's toString().
    const wrapped = Object.assign(new Error('secret file text'), {
      name: 'UnknownErrorException',
      details: 'TypeError: secret file text',
    });
    vi.mocked(pdfParse).mockRejectedValue(wrapped);

    const rejection = await extractCvText(Buffer.from('x'), 'application/pdf').catch((e: unknown) => e);

    expect(rejection).toBe(wrapped);
    expect((rejection as Error).name).toBe('UnknownErrorException(TypeError)');
    expect((rejection as Error).name).not.toContain('secret');
  });

  describe('annotatePdfParseError', () => {
    const annotated = (err: object) => {
      annotatePdfParseError(err);
      return (err as { name: string }).name;
    };

    it('accepts a bare class name (empty message) and bounded identifiers only', () => {
      expect(annotated({ name: 'UnknownErrorException', details: 'FormatError' })).toBe(
        'UnknownErrorException(FormatError)',
      );
      expect(annotated({ name: 'UnknownErrorException', details: 'not an error: text' })).toBe('UnknownErrorException');
      expect(annotated({ name: 'UnknownErrorException', details: `${'A'.repeat(65)}: x` })).toBe(
        'UnknownErrorException',
      );
    });

    it('leaves errors without string details, or with the same class, untouched', () => {
      expect(annotated(new Error('corrupt PDF'))).toBe('Error');
      expect(annotated({ name: 'UnknownErrorException', details: undefined })).toBe('UnknownErrorException');
      expect(annotated({ name: 'TypeError', details: 'TypeError: x' })).toBe('TypeError');
      expect(() => annotatePdfParseError('a string')).not.toThrow();
      expect(() => annotatePdfParseError(null)).not.toThrow();
    });
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
