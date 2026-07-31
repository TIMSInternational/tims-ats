import { logger } from '@tims/shared';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateAiService } from './candidate-ai.service';
import { fetchCvObject } from '../lib/s3';
import { extractCvText, type CvContentType } from '../lib/cv-extraction';

function contentTypeFromKey(key: string): CvContentType {
  if (key.endsWith('.pdf')) return 'application/pdf';
  if (key.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  throw new Error(`Cannot infer CV content type from key: ${key}`);
}

// S3 fetch + PDF/DOCX parse + a Bedrock round-trip have no deadline of their own — without
// one here, a slow/adversarial input could run past the platform's own function timeout and
// take the whole (already-committed) application submission down with it. This bounds
// processCvUpload's own promise; it does not cancel the underlying work, which may keep
// running detached — acceptable, since nothing awaits or depends on it after the race.
const CV_PROCESSING_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export const portalApplicationService = {
  /**
   * Fetches an uploaded CV from S3, extracts its text, and runs it through the
   * gated cv-parser agent. NEVER throws: a candidate's application must always
   * succeed even if their file is corrupt, unreadable, or the AI call fails.
   * The CandidateDocument row is created as soon as the upload itself is
   * confirmed (so staff can see a file was submitted), before extraction is
   * attempted — a later extraction/parse failure leaves that row without
   * parsedData rather than rolling it back. The whole chain is time-boxed
   * (see CV_PROCESSING_TIMEOUT_MS) so a slow S3/parse/AI call can't run past
   * the platform's own function timeout.
   */
  async processCvUpload(orgId: string, candidateId: string, cvFileKey: string, fileName: string): Promise<void> {
    try {
      await withTimeout(
        (async () => {
          const { buffer, sizeBytes } = await fetchCvObject(cvFileKey);
          const doc = await candidateRepository.createDocument(orgId, {
            candidateId,
            type: 'cv',
            fileName,
            fileUrl: cvFileKey,
            fileSize: sizeBytes,
          });

          const text = await extractCvText(buffer, contentTypeFromKey(cvFileKey));
          await candidateAiService.parseCV(orgId, text, doc.id, candidateId);
        })(),
        CV_PROCESSING_TIMEOUT_MS,
        'CV upload processing',
      );
    } catch (error) {
      logger.error(
        {
          component: 'portal-application',
          orgId,
          candidateId,
          errMessage: error instanceof Error ? error.message : String(error),
        },
        'CV upload processing failed — application still succeeds without parsed CV data',
      );
    }
  },
};
