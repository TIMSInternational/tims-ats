import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const CV_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type CvContentType = (typeof CV_ALLOWED_CONTENT_TYPES)[number];

/**
 * The pdf.js build pdf-parse runs (also its default). Pinned because the web app traces
 * exactly this build's pdf.js + pdf.worker.js into every server function
 * (apps/web/next.config.ts outputFileTracingIncludes): pdf-parse requires it through a
 * template-literal path. Change both together — tests/candidate/cv-pdf-packaging.test.ts
 * fails if they drift.
 */
export const PDFJS_BUILD_VERSION = 'v1.10.100' as const;

// "TypeError: …" → "TypeError". Identifier only, bounded; anything else is ignored.
const LEADING_ERROR_CLASS = /^([A-Za-z][A-Za-z0-9_]{0,63})(?::|$)/;

/**
 * pdf.js reports every worker-side failure it does not recognise (anything but its own
 * InvalidPDF/MissingPDF/Password/UnexpectedResponse exceptions) as `UnknownErrorException`
 * and keeps the original only in `details` (its `toString()`, e.g. "TypeError: …"). The
 * CV-processing failure log records nothing but the error NAME — messages can echo file
 * content — so append the original error's CLASS name (never its message):
 * `UnknownErrorException(TypeError)` points at the runtime, `(FormatError)` at the file.
 */
export function annotatePdfParseError(error: unknown): void {
  if (typeof error !== 'object' || error === null || !('name' in error) || !('details' in error)) return;
  const { name, details } = error;
  if (typeof name !== 'string' || typeof details !== 'string') return;
  const inner = LEADING_ERROR_CLASS.exec(details)?.[1];
  if (inner && inner !== name) (error as { name: string }).name = `${name}(${inner})`;
}

export async function extractCvText(buffer: Buffer, contentType: CvContentType): Promise<string> {
  if (contentType === 'application/pdf') {
    try {
      const result = await pdfParse(buffer, { version: PDFJS_BUILD_VERSION });
      return result.text;
    } catch (error) {
      annotatePdfParseError(error);
      throw error;
    }
  }
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error(`Unsupported CV content type: ${contentType}`);
}
