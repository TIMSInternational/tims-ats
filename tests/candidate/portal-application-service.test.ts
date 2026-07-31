import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchCvObjectMock = vi.fn();
vi.mock('../../packages/api/src/lib/s3', () => ({
  fetchCvObject: (...a: unknown[]) => fetchCvObjectMock(...a),
}));

const extractCvTextMock = vi.fn();
vi.mock('../../packages/api/src/lib/cv-extraction', () => ({
  extractCvText: (...a: unknown[]) => extractCvTextMock(...a),
}));

const createDocumentMock = vi.fn();
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: { createDocument: (...a: unknown[]) => createDocumentMock(...a) },
}));

const parseCVMock = vi.fn();
vi.mock('../../packages/api/src/services/candidate-ai.service', () => ({
  candidateAiService: { parseCV: (...a: unknown[]) => parseCVMock(...a) },
}));

import { portalApplicationService } from '../../packages/api/src/services/portal-application.service';

const ORG_ID = 'org-1';
const CANDIDATE_ID = 'cand-1';
const KEY = 'cv-uploads/org-1/abc.pdf';

beforeEach(() => {
  vi.clearAllMocks();
  fetchCvObjectMock.mockResolvedValue({ buffer: Buffer.from('pdf bytes'), sizeBytes: 1024 });
  createDocumentMock.mockResolvedValue({ id: 'doc-1' });
  extractCvTextMock.mockResolvedValue('extracted CV text');
  parseCVMock.mockResolvedValue({ parsed: true });
});

describe('portalApplicationService.processCvUpload', () => {
  it('fetches, creates the document, extracts, and parses on the happy path', async () => {
    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');

    expect(fetchCvObjectMock).toHaveBeenCalledWith(KEY);
    expect(createDocumentMock).toHaveBeenCalledWith(ORG_ID, {
      candidateId: CANDIDATE_ID,
      type: 'cv',
      fileName: 'resume.pdf',
      fileUrl: KEY,
      fileSize: 1024,
    });
    expect(extractCvTextMock).toHaveBeenCalledWith(Buffer.from('pdf bytes'), 'application/pdf');
    expect(parseCVMock).toHaveBeenCalledWith(ORG_ID, 'extracted CV text', 'doc-1', CANDIDATE_ID);
  });

  it('never throws when the S3 fetch fails, and creates no document', async () => {
    fetchCvObjectMock.mockRejectedValue(new Error('object not found'));

    await expect(
      portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf'),
    ).resolves.toBeUndefined();
    expect(createDocumentMock).not.toHaveBeenCalled();
  });

  it('keeps the document when extraction fails, but never calls parseCV', async () => {
    extractCvTextMock.mockRejectedValue(new Error('corrupt PDF'));

    await expect(
      portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf'),
    ).resolves.toBeUndefined();
    expect(createDocumentMock).toHaveBeenCalledTimes(1);
    expect(parseCVMock).not.toHaveBeenCalled();
  });

  it('never throws when parseCV itself fails', async () => {
    parseCVMock.mockRejectedValue(new Error('AI budget exceeded'));

    await expect(
      portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf'),
    ).resolves.toBeUndefined();
    expect(createDocumentMock).toHaveBeenCalledTimes(1);
  });

  it('infers docx content type from the key extension', async () => {
    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, 'cv-uploads/org-1/x.docx', 'resume.docx');

    expect(extractCvTextMock).toHaveBeenCalledWith(
      expect.anything(),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });
});
