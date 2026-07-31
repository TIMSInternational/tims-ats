import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => {
  class MockS3Client {
    send = sendMock;
  }
  class MockHeadObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class MockGetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return {
    S3Client: MockS3Client,
    HeadObjectCommand: MockHeadObjectCommand,
    GetObjectCommand: MockGetObjectCommand,
  };
});

const createPresignedPostMock = vi.fn();
vi.mock('@aws-sdk/s3-presigned-post', () => ({
  createPresignedPost: (...args: unknown[]) => createPresignedPostMock(...args),
}));

import { createCvUploadPresignedPost, fetchCvObject, CV_MAX_BYTES } from '../../packages/api/src/lib/s3';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads-test');
  vi.stubEnv('AWS_REGION', 'us-east-1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('createCvUploadPresignedPost', () => {
  it('builds an org-scoped key with the correct extension and forwards size/content-type conditions', async () => {
    createPresignedPostMock.mockResolvedValue({ url: 'https://s3.example.com', fields: { key: 'x' } });

    const result = await createCvUploadPresignedPost('org-1', 'application/pdf');

    expect(result.key).toMatch(/^cv-uploads\/org-1\/[0-9a-f-]+\.pdf$/);
    expect(createPresignedPostMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        Bucket: 'tims-cv-uploads-test',
        Key: result.key,
        Conditions: [
          ['content-length-range', 0, CV_MAX_BYTES],
          ['eq', '$Content-Type', 'application/pdf'],
        ],
      }),
    );
  });

  it('uses a .docx extension for the DOCX content type', async () => {
    createPresignedPostMock.mockResolvedValue({ url: 'https://s3.example.com', fields: {} });

    const result = await createCvUploadPresignedPost(
      'org-1',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(result.key).toMatch(/\.docx$/);
  });

  it('throws when CV_UPLOADS_BUCKET is not configured', async () => {
    vi.unstubAllEnvs();
    await expect(createCvUploadPresignedPost('org-1', 'application/pdf')).rejects.toThrow('CV_UPLOADS_BUCKET');
  });
});

describe('fetchCvObject', () => {
  it('returns the buffer and size for a valid object', async () => {
    sendMock
      .mockResolvedValueOnce({ ContentLength: 1024 })
      .mockResolvedValueOnce({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } });

    const result = await fetchCvObject('cv-uploads/org-1/x.pdf');

    expect(result.sizeBytes).toBe(1024);
    expect(Buffer.from(result.buffer)).toEqual(Buffer.from([1, 2, 3]));
  });

  it('throws when the object exceeds the size cap', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: CV_MAX_BYTES + 1 });

    await expect(fetchCvObject('cv-uploads/org-1/x.pdf')).rejects.toThrow('size check');
  });

  it('throws when the object is empty or missing', async () => {
    sendMock.mockResolvedValueOnce({ ContentLength: 0 });

    await expect(fetchCvObject('cv-uploads/org-1/x.pdf')).rejects.toThrow('size check');
  });
});
