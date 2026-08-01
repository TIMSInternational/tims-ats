import { describe, it, expect, vi, beforeEach } from 'vitest';

// Whole-branch-review fix — candidate.parseCV router wiring.
//
// Sprint 1.5 Task 5 added an optional 4th `candidateId` param to
// candidateAiService.parseCV so parsed education/languages get promoted onto
// the Candidate row (feeding the FIT Engine's education/languages
// dimensions). That capability was never wired: the router's parseCV
// procedure had no candidateId in its input schema and never passed one, so
// the ONLY caller (this router) always called the service with
// candidateId=undefined — the promotion path was dead in production.
//
// This test exercises the WIRING end-to-end through the tRPC caller: it
// proves the router now requires candidateId, scopes it via assertScoped,
// and forwards it through to candidateAiService.parseCV so the service-level
// promotion logic (already covered by tests/ai/candidate-ai-parse.test.ts)
// actually gets invoked from production code.

const parseCVMock = vi.fn();
vi.mock('../../packages/api/src/services/candidate-ai.service', () => ({
  candidateAiService: { parseCV: (...a: unknown[]) => parseCVMock(...a) },
}));

const getDocumentMock = vi.fn();
const uploadDocumentMock = vi.fn();
const deleteDocumentMock = vi.fn();
vi.mock('../../packages/api/src/services/candidate-documents.service', () => ({
  candidateDocumentsService: {
    getDocument: (...a: unknown[]) => getDocumentMock(...a),
    uploadDocument: (...a: unknown[]) => uploadDocumentMock(...a),
    deleteDocument: (...a: unknown[]) => deleteDocumentMock(...a),
  },
}));

const accessAllowed = vi.hoisted(() => ({ value: true }));
function setAccessAllowed(value: boolean) {
  accessAllowed.value = value;
}
const buildAccessForUserMock = vi.hoisted(() =>
  vi.fn(async () =>
    accessAllowed.value ? { allowed: true, scope: 'organization', roles: ['hr_admin'] } : { allowed: false },
  ),
);
const assertScopedMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('../../packages/api/src/access', async () => {
  const actual = await vi.importActual<typeof import('../../packages/api/src/access')>('../../packages/api/src/access');
  return {
    ...actual,
    buildAccessForUser: buildAccessForUserMock,
    assertScoped: assertScopedMock,
    scopeWhereFor: vi.fn().mockResolvedValue({}),
  };
});

const ORG_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const CANDIDATE_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const DOCUMENT_ID = 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { candidateRouter } = await import('../../packages/api/src/routers/candidate');
  const testRouter = router({ candidate: candidateRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: {
      id: 'user-1',
      organizationId: ORG_ID,
      roles: ['hr_admin'],
      isPlatformOwner: false,
      impersonatorId: null,
      email: 'hr@tims.co',
      isActive: true,
    },
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    candidate: {
      parseCV(input: { candidateId: string; text: string; documentId?: string }): Promise<unknown>;
    };
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAccessAllowed(true);
});

describe('candidate.parseCV wiring', () => {
  it('requires candidateId in the input schema', async () => {
    const caller = await makeCaller();
    await expect(
      // @ts-expect-error — intentionally omitting the now-required candidateId
      caller.candidate.parseCV({ text: 'cv text' }),
    ).rejects.toThrow();
    expect(parseCVMock).not.toHaveBeenCalled();
  });

  it('scopes candidateId via assertScoped before calling the service', async () => {
    parseCVMock.mockResolvedValue({ parsed: true });
    const caller = await makeCaller();
    await caller.candidate.parseCV({ candidateId: CANDIDATE_ID, text: 'cv text' });

    expect(assertScopedMock).toHaveBeenCalledWith('candidate', CANDIDATE_ID, expect.anything(), 'user-1', ORG_ID);
  });

  it('forwards candidateId through to candidateAiService.parseCV — closing the dead promotion seam', async () => {
    parseCVMock.mockResolvedValue({ parsed: true });
    const caller = await makeCaller();
    await caller.candidate.parseCV({ candidateId: CANDIDATE_ID, text: 'cv text' });

    expect(parseCVMock).toHaveBeenCalledWith(ORG_ID, 'cv text', undefined, CANDIDATE_ID);
  });

  it('also forwards documentId when the parse should persist to a document, after verifying it belongs to candidateId', async () => {
    getDocumentMock.mockResolvedValue({ id: DOCUMENT_ID, candidateId: CANDIDATE_ID });
    parseCVMock.mockResolvedValue({ parsed: true });
    const caller = await makeCaller();
    await caller.candidate.parseCV({ candidateId: CANDIDATE_ID, text: 'cv text', documentId: DOCUMENT_ID });

    expect(getDocumentMock).toHaveBeenCalledWith(ORG_ID, DOCUMENT_ID);
    expect(parseCVMock).toHaveBeenCalledWith(ORG_ID, 'cv text', DOCUMENT_ID, CANDIDATE_ID);
  });

  it('404s and never calls the AI service when documentId belongs to a different candidate (IDOR guard)', async () => {
    getDocumentMock.mockResolvedValue({ id: DOCUMENT_ID, candidateId: 'some-other-candidate' });
    const caller = await makeCaller();

    await expect(
      caller.candidate.parseCV({ candidateId: CANDIDATE_ID, text: 'cv text', documentId: DOCUMENT_ID }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(parseCVMock).not.toHaveBeenCalled();
  });

  it('throws FORBIDDEN and never queries when the caller lacks candidate:update', async () => {
    setAccessAllowed(false);
    const caller = await makeCaller();
    await expect(caller.candidate.parseCV({ candidateId: CANDIDATE_ID, text: 'cv text' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(parseCVMock).not.toHaveBeenCalled();
  });
});
