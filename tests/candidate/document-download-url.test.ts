import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// candidate.getDocumentUrl — staff open/download of a stored candidate file via a short-lived signed GET.
//
// The repository runs for real against an in-memory candidate_documents table, so the tenant and
// candidate predicates are exercised (not mocked away): a document id that belongs to another org or
// another candidate must resolve to NOT_FOUND. The presigner is mocked, as the S3 SDK is in
// tests/candidate/cv-upload-s3.test.ts.

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const OTHER_ORG_ID = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const CANDIDATE_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const OTHER_CANDIDATE_ID = 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a34';
const OBJECT_ID = '5f0e4f3c-9a63-4b8f-8f6f-0c1a2b3c4d5e';

const DOC = {
  own: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a40',
  ownDocx: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a41',
  crossOrg: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a42',
  otherCandidate: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a43',
  foreignPrefix: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
  mockUrl: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a45',
  traversal: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a46',
  missing: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a47',
};

interface Row {
  id: string;
  organizationId: string;
  candidateId: string;
  fileName: string;
  fileUrl: string;
}

const ROWS: Row[] = [
  {
    id: DOC.own,
    organizationId: ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'Hoja de vida "Ana"\r\n.pdf',
    fileUrl: `cv-uploads/${ORG_ID}/${OBJECT_ID}.pdf`,
  },
  {
    id: DOC.ownDocx,
    organizationId: ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'cv-ana',
    fileUrl: `cv-uploads/${ORG_ID}/${OBJECT_ID}.docx`,
  },
  {
    id: DOC.crossOrg,
    organizationId: OTHER_ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'x.pdf',
    fileUrl: `cv-uploads/${OTHER_ORG_ID}/${OBJECT_ID}.pdf`,
  },
  {
    id: DOC.otherCandidate,
    organizationId: ORG_ID,
    candidateId: OTHER_CANDIDATE_ID,
    fileName: 'x.pdf',
    fileUrl: `cv-uploads/${ORG_ID}/${OBJECT_ID}.pdf`,
  },
  {
    id: DOC.foreignPrefix,
    organizationId: ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'x.pdf',
    fileUrl: `cv-uploads/${OTHER_ORG_ID}/${OBJECT_ID}.pdf`,
  },
  {
    id: DOC.mockUrl,
    organizationId: ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'x.pdf',
    fileUrl: `https://storage.tims.app/${ORG_ID}/${CANDIDATE_ID}/x.pdf`,
  },
  {
    id: DOC.traversal,
    organizationId: ORG_ID,
    candidateId: CANDIDATE_ID,
    fileName: 'x.pdf',
    fileUrl: `cv-uploads/${ORG_ID}/../${OTHER_ORG_ID}/${OBJECT_ID}.pdf`,
  },
];

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  dataAccessLogCreate: vi.fn(),
  getSignedUrl: vi.fn(),
  accessAllowed: true,
  assertScoped: vi.fn(),
  events: [] as string[],
}));

vi.mock('@tims/db', async () => {
  const actual = await vi.importActual<typeof import('@tims/db')>('@tims/db');
  return {
    ...actual,
    tenantDb: {
      candidateDocument: { findFirst: (...a: unknown[]) => mocks.findFirst(...a) },
      dataAccessLog: { create: (...a: unknown[]) => mocks.dataAccessLogCreate(...a) },
    },
    db: { auditLog: { create: vi.fn().mockResolvedValue({}) } },
    runWithTenant: (_orgId: string | null, fn: () => unknown) => fn(),
  };
});

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...a: unknown[]) => mocks.getSignedUrl(...a),
}));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: vi.fn(async () =>
      mocks.accessAllowed ? { allowed: true, scope: 'organization', roles: ['recruiter'] } : { allowed: false },
    ),
    assertScoped: (...a: unknown[]) => mocks.assertScoped(...a),
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});

/** The in-memory equivalent of the repository's findFirst: every `where` key must match. */
function inMemoryFindFirst(args: { where: Record<string, unknown>; select: Record<string, boolean> }) {
  const row = ROWS.find((r) =>
    Object.entries(args.where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v),
  );
  if (!row) return Promise.resolve(null);
  const picked: Record<string, unknown> = {};
  for (const k of Object.keys(args.select)) picked[k] = (row as unknown as Record<string, unknown>)[k];
  return Promise.resolve(picked);
}

type Caller = {
  candidate: {
    getDocumentUrl(input: {
      candidateId: string;
      documentId: string;
    }): Promise<{ url: string; expiresInSeconds: number }>;
  };
};

async function makeCaller(): Promise<Caller> {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { candidateRouter } = await import('../../packages/api/src/routers/candidate');
  const callerFactory = createCallerFactory(router({ candidate: candidateRouter }));
  return callerFactory({
    user: {
      id: 'user-1',
      organizationId: ORG_ID,
      roles: ['recruiter'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'recruiter@example.test',
      isActive: true,
    },
    headers: new Headers({ 'user-agent': 'vitest', 'x-real-ip': '203.0.113.7' }),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as Caller;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events = [];
  mocks.accessAllowed = true;
  mocks.assertScoped.mockResolvedValue(undefined);
  mocks.findFirst.mockImplementation(inMemoryFindFirst);
  mocks.dataAccessLogCreate.mockImplementation(async () => {
    mocks.events.push('audit');
    return {};
  });
  mocks.getSignedUrl.mockImplementation(async () => {
    mocks.events.push('sign');
    return 'https://bucket.s3.us-west-2.amazonaws.com/signed?X-Amz-Expires=300';
  });
  vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads-test');
  vi.stubEnv('CV_UPLOADS_REGION', 'us-west-2');
  // Hermetic even if the presigner mock ever stops intercepting: never sign with a developer's real keys.
  vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIATESTTESTTESTTEST');
  vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('AWS_SESSION_TOKEN', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('candidate.getDocumentUrl', () => {
  it('returns a signed URL for an own-org document of that candidate, expiring in 300s', async () => {
    const caller = await makeCaller();
    const result = await caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.own });

    expect(result).toEqual({
      url: 'https://bucket.s3.us-west-2.amazonaws.com/signed?X-Amz-Expires=300',
      expiresInSeconds: 300,
    });
    expect(mocks.assertScoped).toHaveBeenCalledWith('candidate', CANDIDATE_ID, expect.anything(), 'user-1', ORG_ID);

    // The lookup carries BOTH tenant and candidate predicates and selects only what it needs.
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: DOC.own, candidateId: CANDIDATE_ID, organizationId: ORG_ID },
      select: { id: true, fileName: true, fileUrl: true },
    });

    expect(mocks.getSignedUrl).toHaveBeenCalledTimes(1);
    const [, command, options] = mocks.getSignedUrl.mock.calls[0] as [
      unknown,
      { input: Record<string, string> },
      { expiresIn: number },
    ];
    expect(options).toEqual({ expiresIn: 300 });
    expect(command.input).toMatchObject({
      Bucket: 'tims-cv-uploads-test',
      Key: `cv-uploads/${ORG_ID}/${OBJECT_ID}.pdf`,
      ResponseContentType: 'application/pdf',
    });
    // Header-safe filename: quotes and CR/LF stripped, never injected into the header.
    expect(command.input.ResponseContentDisposition).toBe(
      `inline; filename="Hoja de vida Ana.pdf"; filename*=UTF-8''Hoja%20de%20vida%20Ana.pdf`,
    );
  });

  it('serves a DOCX as an attachment with its own content type', async () => {
    const caller = await makeCaller();
    await caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.ownDocx });
    const [, command] = mocks.getSignedUrl.mock.calls[0] as [unknown, { input: Record<string, string> }];
    expect(command.input.ResponseContentType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(command.input.ResponseContentDisposition).toMatch(/^attachment; filename="cv-ana\.docx"/);
  });

  it('writes a data_access_logs row BEFORE signing, attributed to the actor', async () => {
    const caller = await makeCaller();
    await caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.own });
    expect(mocks.events).toEqual(['audit', 'sign']);
    expect(mocks.dataAccessLogCreate).toHaveBeenCalledWith({
      data: {
        organizationId: ORG_ID,
        actorId: 'user-1',
        dataType: 'candidateDocument',
        recordId: DOC.own,
        action: 'read',
        ipAddress: '203.0.113.7',
        userAgent: 'vitest',
      },
    });
  });

  it('fails closed: no audit row, no link', async () => {
    mocks.dataAccessLogCreate.mockRejectedValueOnce(new Error('db down'));
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.own }),
    ).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('NOT_FOUND for a document that belongs to another organization', async () => {
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.crossOrg }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(mocks.dataAccessLogCreate).not.toHaveBeenCalled();
  });

  it('NOT_FOUND for a document of a different candidate in the same org', async () => {
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.otherCandidate }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('NOT_FOUND for an unknown document id', async () => {
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.missing }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    ['another org prefix', DOC.foreignPrefix],
    ['a non-S3 URL from the mock staff upload', DOC.mockUrl],
    ['a path-traversal key', DOC.traversal],
  ])('refuses to sign a stored key outside the org prefix (%s)', async (_label, documentId) => {
    const caller = await makeCaller();
    await expect(caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'document_file_unavailable',
    });
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
    expect(mocks.dataAccessLogCreate).not.toHaveBeenCalled();
  });

  it('FORBIDDEN without candidate:read, before any lookup', async () => {
    mocks.accessAllowed = false;
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.own }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('a candidate outside the caller scope is refused before any lookup', async () => {
    const { TRPCError } = await import('@trpc/server');
    mocks.assertScoped.mockRejectedValueOnce(new TRPCError({ code: 'NOT_FOUND', message: 'Candidato no encontrado' }));
    const caller = await makeCaller();
    await expect(
      caller.candidate.getDocumentUrl({ candidateId: CANDIDATE_ID, documentId: DOC.own }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('rejects non-uuid input', async () => {
    const caller = await makeCaller();
    await expect(caller.candidate.getDocumentUrl({ candidateId: 'x', documentId: DOC.own })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
  });
});

describe('S3 helpers (defence in depth)', () => {
  it('cvKeyExtensionForOrg accepts only <prefix>/<single segment>.<pdf|docx>', async () => {
    const { cvKeyExtensionForOrg } = await import('../../packages/api/src/lib/s3');
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${ORG_ID}/${OBJECT_ID}.pdf`)).toBe('pdf');
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${ORG_ID}/${OBJECT_ID}.docx`)).toBe('docx');
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${OTHER_ORG_ID}/${OBJECT_ID}.pdf`)).toBeNull();
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${ORG_ID}/a/b.pdf`)).toBeNull();
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${ORG_ID}/x.html`)).toBeNull();
    expect(cvKeyExtensionForOrg(ORG_ID, `cv-uploads/${ORG_ID}x/${OBJECT_ID}.pdf`)).toBeNull();
  });

  it('createCvDownloadUrl never signs a key outside the org prefix, even if called directly', async () => {
    const { createCvDownloadUrl } = await import('../../packages/api/src/lib/s3');
    await expect(createCvDownloadUrl(ORG_ID, `cv-uploads/${OTHER_ORG_ID}/${OBJECT_ID}.pdf`, 'x.pdf')).rejects.toThrow(
      'outside the organization upload prefix',
    );
    expect(mocks.getSignedUrl).not.toHaveBeenCalled();
  });

  it('contentDispositionFor keeps non-ASCII names in filename* and an ASCII fallback', async () => {
    const { contentDispositionFor } = await import('../../packages/api/src/lib/s3');
    expect(contentDispositionFor('inline', 'Currículum José.pdf', 'pdf')).toBe(
      `inline; filename="Curr_culum Jos_.pdf"; filename*=UTF-8''Curr%C3%ADculum%20Jos%C3%A9.pdf`,
    );
    expect(contentDispositionFor('attachment', '../../etc;passwd', 'docx')).toBe(
      `attachment; filename="....etcpasswd.docx"; filename*=UTF-8''....etcpasswd.docx`,
    );
    expect(contentDispositionFor('inline', '', 'pdf')).toBe(`inline; filename="cv.pdf"; filename*=UTF-8''cv.pdf`);
  });
});
