import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

export const CV_ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type CvContentType = (typeof CV_ALLOWED_CONTENT_TYPES)[number];

export async function extractCvText(buffer: Buffer, contentType: CvContentType): Promise<string> {
  if (contentType === 'application/pdf') {
    const result = await pdfParse(buffer);
    return result.text;
  }
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  throw new Error(`Unsupported CV content type: ${contentType}`);
}
