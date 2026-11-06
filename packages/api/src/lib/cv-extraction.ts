import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const CV_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type CvContentType = (typeof CV_ALLOWED_CONTENT_TYPES)[number];

/**
 * The pdf.js build pdf-parse runs (also its default). Pinned because the web app lists
 * exactly this build's pdf.js + pdf.worker.js in every server function's file trace
 * (apps/web/next.config.ts outputFileTracingIncludes) rather than relying on the tracer to
 * follow pdf-parse's template-literal require. Change both together —
 * tests/candidate/cv-pdf-packaging.test.ts fails if they drift.
 */
export const PDFJS_BUILD_VERSION = 'v1.10.100' as const;

// pdf-parse hands its input straight to pdf.js, which accepts any Uint8Array; its types say Buffer.
const parsePdfBytes = pdfParse as (
  data: Uint8Array,
  options?: Parameters<typeof pdfParse>[1],
) => ReturnType<typeof pdfParse>;

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
      // A plain Uint8Array copy, never the Buffer itself: pdf.js 1.10 copies its input with
      // `new input.constructor(input)` and reads every PDF stream from `bytes.buffer`, ignoring
      // `byteOffset`. A Buffer under 4 KB is a slice of Node's shared pool (nonzero byteOffset), and
      // so is pdf.js's Buffer copy, so small PDFs parsed the wrong bytes ("bad XRef entry") about
      // half the time. A Uint8Array copy owns its ArrayBuffer at offset 0, and so does pdf.js's copy.
      const result = await parsePdfBytes(new Uint8Array(buffer), { version: PDFJS_BUILD_VERSION });
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
