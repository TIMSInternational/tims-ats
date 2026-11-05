import { beforeEach, describe, expect, it, vi } from 'vitest';

// A-21: staff attach a document through the same presigned S3 path as the public apply flow. The service
// only records an object that lies in the org's own upload prefix, actually exists (<= 5 MB), was uploaded
// through a presigned POST issued for THIS candidate (pinned in signed S3 metadata) and is not on record
// already — and never for a candidate who revoked the data-processing authorization.

const m = vi.hoisted(() => ({
  exists: vi.fn(),
  createDocument: vi.fn(),
  findByKey: vi.fn(),
  withdrawn: vi.fn(),
  size: vi.fn(),
  presign: vi.fn(),
}));
vi.mock('../../packages/api/src/repositories/candidate.repository', () => ({
  candidateRepository: { exists: m.exists, createDocument: m.createDocument, findDocumentByFileKey: m.findByKey },
}));
vi.mock('../../packages/api/src/repositories/candidate-consent.repository', () => ({
  candidateConsentRepository: { isRecruitmentConsentWithdrawn: m.withdrawn, withdrawnCandidateIds: vi.fn() },
}));
vi.mock('../../packages/api/src/lib/s3', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/lib/s3')>('../../packages/api/src/lib/s3');
  return { ...actual, cvObjectHead: m.size, createCvUploadPresignedPost: m.presign };
});

import { candidateDocumentsService } from '../../packages/api/src/services/candidate-documents.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const CANDIDATE = '33333333-3333-4333-8333-333333333333';
const KEY = `cv-uploads/${ORG}/0b9f3c1e-5c1a-4b7e-9a51-1f2d3c4b5a69.pdf`;

beforeEach(() => {
  vi.clearAllMocks();
  m.exists.mockResolvedValue({ id: CANDIDATE });
  m.withdrawn.mockResolvedValue(false);
  m.size.mockResolvedValue({ sizeBytes: 20_000, candidateId: CANDIDATE });
  m.findByKey.mockResolvedValue(null);
  m.createDocument.mockImplementation(async (_org: string, data: Record<string, unknown>) => ({ id: 'doc-1', ...data }));
  m.presign.mockResolvedValue({ url: 'https://bucket.example.test', fields: {}, key: KEY });
});

describe('candidateDocumentsService staff upload', () => {
  it('issues a presigned POST into the org prefix, pinned to the candidate', async () => {
    await candidateDocumentsService.getUploadUrl(ORG, CANDIDATE, 'application/pdf');
    expect(m.presign).toHaveBeenCalledWith(ORG, 'application/pdf', { candidateId: CANDIDATE });
  });

  it('refuses an object uploaded for another candidate, or not through a staff upload at all (Codex P1)', async () => {
    m.size.mockResolvedValue({ sizeBytes: 20_000, candidateId: '44444444-4444-4444-8444-444444444444' });
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', KEY)).rejects.toMatchObject({
      message: 'document_key_invalid',
    });
    m.size.mockResolvedValue({ sizeBytes: 20_000, candidateId: null });
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', KEY)).rejects.toMatchObject({
      message: 'document_key_invalid',
    });
    expect(m.createDocument).not.toHaveBeenCalled();
  });

  it('never re-attaches a key that is already on record', async () => {
    m.findByKey.mockResolvedValue({ id: 'existing-doc' });
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', KEY)).rejects.toMatchObject({
      message: 'document_key_invalid',
    });
    expect(m.size).not.toHaveBeenCalled();
    expect(m.createDocument).not.toHaveBeenCalled();
  });

  it('records the uploaded object with its real size and the S3 key as the file location', async () => {
    const doc = await candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'certificate', 'Título.pdf', KEY);
    expect(m.createDocument).toHaveBeenCalledWith(ORG, {
      candidateId: CANDIDATE,
      type: 'certificate',
      fileName: 'Título.pdf',
      fileUrl: KEY,
      fileSize: 20_000,
    });
    expect(doc).toMatchObject({ id: 'doc-1' });
  });

  it.each([
    ['another org prefix', `cv-uploads/${OTHER_ORG}/0b9f3c1e-5c1a-4b7e-9a51-1f2d3c4b5a69.pdf`],
    ['a nested path', `cv-uploads/${ORG}/../x.pdf`],
    ['a non-S3 URL', 'https://storage.tims.app/x.pdf'],
    ['an unsupported extension', `cv-uploads/${ORG}/0b9f3c1e.exe`],
  ])('refuses %s and records nothing', async (_label, key) => {
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', key)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'document_key_invalid',
    });
    expect(m.size).not.toHaveBeenCalled();
    expect(m.createDocument).not.toHaveBeenCalled();
  });

  it.each([
    ['no object was uploaded', () => m.size.mockRejectedValue(new Error('NotFound'))],
    ['the object is empty', () => m.size.mockResolvedValue({ sizeBytes: 0, candidateId: CANDIDATE })],
    ['the object is larger than 5 MB', () => m.size.mockResolvedValue({ sizeBytes: 5 * 1024 * 1024 + 1, candidateId: CANDIDATE })],
  ])('refuses when %s', async (_label, arrange) => {
    arrange();
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', KEY)).rejects.toMatchObject({
      message: 'document_upload_missing',
    });
    expect(m.createDocument).not.toHaveBeenCalled();
  });

  it('refuses a candidate who revoked the authorization, before any upload URL is issued', async () => {
    m.withdrawn.mockResolvedValue(true);
    await expect(candidateDocumentsService.getUploadUrl(ORG, CANDIDATE, 'application/pdf')).rejects.toMatchObject({
      message: 'consent_withdrawn',
    });
    await expect(candidateDocumentsService.uploadDocument(ORG, CANDIDATE, 'cv', 'cv.pdf', KEY)).rejects.toMatchObject({
      message: 'consent_withdrawn',
    });
    expect(m.presign).not.toHaveBeenCalled();
    expect(m.createDocument).not.toHaveBeenCalled();
  });
});
