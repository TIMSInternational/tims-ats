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
const findCvDocumentByKeyMock = vi.fn();
const setDocumentFileSizeMock = vi.fn();
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: {
    createDocument: (...a: unknown[]) => createDocumentMock(...a),
    findCvDocumentByKey: (...a: unknown[]) => findCvDocumentByKeyMock(...a),
    setDocumentFileSize: (...a: unknown[]) => setDocumentFileSizeMock(...a),
  },
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
  findCvDocumentByKeyMock.mockResolvedValue(null);
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

  it('is idempotent: an already-parsed CV for this candidate + key is skipped (no S3, no doc, no AI)', async () => {
    findCvDocumentByKeyMock.mockResolvedValue({ id: 'doc-0', parsedData: { parsed: true } });

    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');

    expect(findCvDocumentByKeyMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, KEY);
    expect(fetchCvObjectMock).not.toHaveBeenCalled();
    expect(createDocumentMock).not.toHaveBeenCalled();
    expect(parseCVMock).not.toHaveBeenCalled();
  });

  it('is idempotent: a recorded-but-unparsed CV row is reused, never duplicated', async () => {
    findCvDocumentByKeyMock.mockResolvedValue({ id: 'doc-0', parsedData: null, fileSize: null });

    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');

    expect(createDocumentMock).not.toHaveBeenCalled();
    expect(setDocumentFileSizeMock).toHaveBeenCalledWith(ORG_ID, 'doc-0', 1024);
    expect(parseCVMock).toHaveBeenCalledWith(ORG_ID, 'extracted CV text', 'doc-0', CANDIDATE_ID);
  });

  it('does not rewrite the size of a reused row that already has one', async () => {
    findCvDocumentByKeyMock.mockResolvedValue({ id: 'doc-0', parsedData: null, fileSize: 999 });

    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');

    expect(setDocumentFileSizeMock).not.toHaveBeenCalled();
    expect(parseCVMock).toHaveBeenCalledWith(ORG_ID, 'extracted CV text', 'doc-0', CANDIDATE_ID);
  });

  it('logs a failure without the raw error message (which can echo file content or names)', async () => {
    const { logger } = await import('@tims/shared');
    const errorLog = vi.spyOn(logger, 'error').mockImplementation(() => undefined as never);
    try {
      extractCvTextMock.mockRejectedValue(new Error('corrupt PDF: Ana Gomez ana@example.com'));

      await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');

      expect(errorLog).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify(errorLog.mock.calls[0]);
      expect(serialized).not.toContain('ana@example.com');
      expect(serialized).not.toContain('Ana Gomez');
      expect(serialized).not.toContain('resume.pdf');
      expect(errorLog.mock.calls[0]?.[0]).toMatchObject({ orgId: ORG_ID, errName: 'Error' });
    } finally {
      errorLog.mockRestore();
    }
  });

  it('infers docx content type from the key extension', async () => {
    await portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, 'cv-uploads/org-1/x.docx', 'resume.docx');

    expect(extractCvTextMock).toHaveBeenCalledWith(
      expect.anything(),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('never throws, and never blocks the caller past the timeout, when a step hangs forever', async () => {
    vi.useFakeTimers();
    try {
      fetchCvObjectMock.mockImplementation(() => new Promise(() => {})); // never resolves

      const resultPromise = portalApplicationService.processCvUpload(ORG_ID, CANDIDATE_ID, KEY, 'resume.pdf');
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(resultPromise).resolves.toBeUndefined();
      expect(createDocumentMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
