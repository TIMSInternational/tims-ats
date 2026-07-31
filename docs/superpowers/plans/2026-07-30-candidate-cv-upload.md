# Candidate CV Upload + Real Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a candidate optionally attach a real PDF/DOCX CV on the public apply form; extract its text, run it through the existing `parseCV` agent, and persist a real `CandidateDocument` — closing the gap where the apply flow is 100% text-only and `uploadDocument` is a mock.

**Architecture:** Browser uploads directly to a private S3 bucket via a presigned POST (new public `portal.getCvUploadUrl` procedure mints it). `portal.applyToVacancy` gains an optional `cvFileKey`/`cvFileName` pair; on a new application it synchronously fetches the object from S3, extracts text (`pdf-parse` / `mammoth`), creates the `CandidateDocument` row, and calls the existing `candidateAiService.parseCV` unchanged. All of this is wrapped so it can never fail the application submission itself.

**Tech Stack:** tRPC (`publicProcedure`), Prisma via `candidateRepository`, `@aws-sdk/client-s3` + `@aws-sdk/s3-presigned-post`, `pdf-parse`, `mammoth`, React (Next.js App Router, client components).

**Spec:** `docs/superpowers/specs/2026-07-30-candidate-cv-upload-design.md`

## Global Constraints

- No `any` types. Bound every new string/array input (`.max()`).
- Every new tRPC input goes through Zod (CLAUDE.md §TypeScript).
- No `dangerouslySetInnerHTML`, no raw SQL, no hardcoded secrets.
- New npm packages must be verified to exist before installing (CLAUDE.md AI-code-safety §Dependency Safety) — already verified for this plan: `pdf-parse@1.1.1`, `@types/pdf-parse@1.1.5`, `mammoth@1.12.0`, `@aws-sdk/client-s3@3.1099.0`, `@aws-sdk/s3-presigned-post@3.1099.0` all resolve on the public npm registry as of 2026-07-30.
- Max 300 lines per component file — `apply-modal.tsx` is at 295 lines today and must stay under the cap after this change (Task 7 extracts a subcomponent to make room).
- File size cap for CVs: **5MB**. Accepted types: **PDF and DOCX only** (`application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`).
- CV processing must **never** throw out of the `applyToVacancy` mutation — a candidate's application must always succeed even if their file is corrupt or unreadable.
- Router → Service → Repository pattern applies to all NEW code in this plan (the pre-existing direct-`db` calls elsewhere in `portal.ts` are a documented, out-of-scope deviation — do not touch them).

---

### Task 1: CV text extraction library

**Files:**

- Modify: `packages/api/package.json` (add `pdf-parse`, `@types/pdf-parse`, `mammoth`)
- Create: `packages/api/src/lib/cv-extraction.ts`
- Test: `tests/candidate/cv-extraction.test.ts`

**Interfaces:**

- Produces: `extractCvText(buffer: Buffer, contentType: CvContentType): Promise<string>`, `CV_ALLOWED_CONTENT_TYPES: readonly ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']`, `type CvContentType = (typeof CV_ALLOWED_CONTENT_TYPES)[number]` — all from `packages/api/src/lib/cv-extraction.ts`. Task 2 imports `CV_ALLOWED_CONTENT_TYPES`/`CvContentType` from here.

- [ ] **Step 1: Add the new dependencies**

Edit `packages/api/package.json` — add to `"dependencies"` (alphabetical, matching existing style) and `"devDependencies"`:

```diff
   "dependencies": {
     "@aws-sdk/client-ses": "^3.1057.0",
     "@prisma/client": "^6.8.2",
     "@supabase/supabase-js": "^2.49.0",
     "@tims/ai": "workspace:*",
     "@tims/db": "workspace:*",
     "@tims/shared": "workspace:*",
     "@trpc/server": "^11.1.0",
     "@upstash/ratelimit": "^2.0.8",
     "@upstash/redis": "^1.38.0",
+    "mammoth": "^1.12.0",
+    "pdf-parse": "^1.1.1",
     "stripe": "^22.2.0",
     "superjson": "^2.2.2",
     "zod": "^3.25.0"
   },
   "devDependencies": {
+    "@types/pdf-parse": "^1.1.5",
     "typescript": "^5.8.0"
   }
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing test**

Create `tests/candidate/cv-extraction.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdf-parse', () => ({ default: vi.fn() }));
vi.mock('mammoth', () => ({ default: { extractRawText: vi.fn() } }));

import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { extractCvText, CV_ALLOWED_CONTENT_TYPES } from '../../packages/api/src/lib/cv-extraction';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractCvText', () => {
  it('extracts text from a PDF via pdf-parse', async () => {
    vi.mocked(pdfParse).mockResolvedValue({ text: 'PDF resume text' } as never);
    const buffer = Buffer.from('fake-pdf-bytes');

    const text = await extractCvText(buffer, 'application/pdf');

    expect(pdfParse).toHaveBeenCalledWith(buffer);
    expect(text).toBe('PDF resume text');
  });

  it('extracts text from a DOCX via mammoth', async () => {
    vi.mocked(mammoth.extractRawText).mockResolvedValue({ value: 'DOCX resume text' } as never);
    const buffer = Buffer.from('fake-docx-bytes');

    const text = await extractCvText(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');

    expect(mammoth.extractRawText).toHaveBeenCalledWith({ buffer });
    expect(text).toBe('DOCX resume text');
  });

  it('propagates a thrown error from the underlying PDF parser', async () => {
    vi.mocked(pdfParse).mockRejectedValue(new Error('corrupt PDF'));
    const buffer = Buffer.from('garbage');

    await expect(extractCvText(buffer, 'application/pdf')).rejects.toThrow('corrupt PDF');
  });

  it('throws for an unsupported content type', async () => {
    const buffer = Buffer.from('irrelevant');

    // @ts-expect-error — intentionally passing an unsupported content type
    await expect(extractCvText(buffer, 'image/png')).rejects.toThrow('Unsupported CV content type');
  });

  it('exposes exactly the two supported content types', () => {
    expect(CV_ALLOWED_CONTENT_TYPES).toEqual([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/candidate/cv-extraction.test.ts`
Expected: FAIL — `Cannot find module '../../packages/api/src/lib/cv-extraction'`

- [ ] **Step 4: Write the implementation**

Create `packages/api/src/lib/cv-extraction.ts`:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/candidate/cv-extraction.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Type-check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/api/package.json pnpm-lock.yaml packages/api/src/lib/cv-extraction.ts tests/candidate/cv-extraction.test.ts
git commit -m "feat(candidate): add PDF/DOCX CV text extraction library"
```

---

### Task 2: S3 presigned upload + object fetch library

**Files:**

- Modify: `packages/api/package.json` (add `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`)
- Create: `packages/api/src/lib/s3.ts`
- Test: `tests/candidate/cv-upload-s3.test.ts`

**Interfaces:**

- Consumes: `CV_ALLOWED_CONTENT_TYPES`, `CvContentType` from `packages/api/src/lib/cv-extraction.ts` (Task 1).
- Produces: `createCvUploadPresignedPost(orgId: string, contentType: CvContentType): Promise<{ url: string; fields: Record<string, string>; key: string }>`, `fetchCvObject(key: string): Promise<{ buffer: Buffer; sizeBytes: number }>`, `CV_MAX_BYTES: number` — all from `packages/api/src/lib/s3.ts`. Task 3 imports `fetchCvObject`. Task 4 imports `createCvUploadPresignedPost`.

- [ ] **Step 1: Add the new dependencies**

Edit `packages/api/package.json`:

```diff
   "dependencies": {
     "@aws-sdk/client-ses": "^3.1057.0",
+    "@aws-sdk/client-s3": "^3.1099.0",
+    "@aws-sdk/s3-presigned-post": "^3.1099.0",
     "@prisma/client": "^6.8.2",
```

Run: `pnpm install`
Expected: lockfile updates, no errors.

- [ ] **Step 2: Write the failing test**

Create `tests/candidate/cv-upload-s3.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  HeadObjectCommand: vi.fn().mockImplementation((input) => ({ input, __type: 'Head' })),
  GetObjectCommand: vi.fn().mockImplementation((input) => ({ input, __type: 'Get' })),
}));

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/candidate/cv-upload-s3.test.ts`
Expected: FAIL — `Cannot find module '../../packages/api/src/lib/s3'`

- [ ] **Step 4: Write the implementation**

Create `packages/api/src/lib/s3.ts`:

```ts
import { S3Client, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomUUID } from 'node:crypto';
import { CV_ALLOWED_CONTENT_TYPES, type CvContentType } from './cv-extraction';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export const CV_MAX_BYTES = 5 * 1024 * 1024;

const CV_EXTENSIONS: Record<CvContentType, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function getBucket(): string {
  const bucket = process.env.CV_UPLOADS_BUCKET;
  if (!bucket) throw new Error('CV_UPLOADS_BUCKET is not configured');
  return bucket;
}

// Presigned S3 POST (not PUT): a POST policy supports a content-length-range
// condition, so the size cap and content-type are enforced by S3 itself at
// upload time, not merely trusted from the client.
export async function createCvUploadPresignedPost(
  orgId: string,
  contentType: CvContentType,
): Promise<{ url: string; fields: Record<string, string>; key: string }> {
  const key = `cv-uploads/${orgId}/${randomUUID()}.${CV_EXTENSIONS[contentType]}`;
  const { url, fields } = await createPresignedPost(s3, {
    Bucket: getBucket(),
    Key: key,
    Conditions: [
      ['content-length-range', 0, CV_MAX_BYTES],
      ['eq', '$Content-Type', contentType],
    ],
    Fields: { 'Content-Type': contentType },
    Expires: 300,
  });
  return { url, fields, key };
}

export async function fetchCvObject(key: string): Promise<{ buffer: Buffer; sizeBytes: number }> {
  const bucket = getBucket();
  const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  const sizeBytes = head.ContentLength ?? 0;
  if (sizeBytes <= 0 || sizeBytes > CV_MAX_BYTES) {
    throw new Error(`CV object failed server-side size check: ${key} (${sizeBytes} bytes)`);
  }
  const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!obj.Body) throw new Error(`CV object has no body: ${key}`);
  const buffer = Buffer.from(await obj.Body.transformToByteArray());
  return { buffer, sizeBytes };
}
```

Note: `CV_ALLOWED_CONTENT_TYPES` is imported here only to keep `CvContentType` in scope for `CV_EXTENSIONS`'s key type — it is not otherwise used in this file, which is fine (TypeScript needs the type import).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/candidate/cv-upload-s3.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Type-check and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: no errors.

```bash
git add packages/api/package.json pnpm-lock.yaml packages/api/src/lib/s3.ts tests/candidate/cv-upload-s3.test.ts
git commit -m "feat(candidate): add S3 presigned-POST upload + object fetch for CVs"
```

---

### Task 3: CV upload orchestration service

**Files:**

- Create: `packages/api/src/services/portal-application.service.ts`
- Modify: `packages/api/src/services/candidate-ai.service.ts:26-33` (stale doc comment)
- Test: `tests/candidate/portal-application-service.test.ts`

**Interfaces:**

- Consumes: `fetchCvObject` (Task 2), `extractCvText`, `CvContentType` (Task 1), `candidateRepository.createDocument` (existing, `packages/api/src/repositories/candidate.repository.ts:315`), `candidateAiService.parseCV` (existing, `packages/api/src/services/candidate-ai.service.ts:34`).
- Produces: `portalApplicationService.processCvUpload(orgId: string, candidateId: string, cvFileKey: string, fileName: string): Promise<void>` from `packages/api/src/services/portal-application.service.ts`. Task 4 imports this.

- [ ] **Step 1: Write the failing test**

Create `tests/candidate/portal-application-service.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/candidate/portal-application-service.test.ts`
Expected: FAIL — `Cannot find module '../../packages/api/src/services/portal-application.service'`

- [ ] **Step 3: Write the implementation**

Create `packages/api/src/services/portal-application.service.ts`:

```ts
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

export const portalApplicationService = {
  /**
   * Fetches an uploaded CV from S3, extracts its text, and runs it through the
   * gated cv-parser agent. NEVER throws: a candidate's application must always
   * succeed even if their file is corrupt, unreadable, or the AI call fails.
   * The CandidateDocument row is created as soon as the upload itself is
   * confirmed (so staff can see a file was submitted), before extraction is
   * attempted — a later extraction/parse failure leaves that row without
   * parsedData rather than rolling it back.
   */
  async processCvUpload(orgId: string, candidateId: string, cvFileKey: string, fileName: string): Promise<void> {
    try {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/candidate/portal-application-service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Fix the stale doc comment in candidate-ai.service.ts**

The `parseCV` doc comment currently says real file extraction is a future phase — that phase is this plan. Edit `packages/api/src/services/candidate-ai.service.ts:26-33`:

```diff
   /**
    * Parse CV text into structured candidate data via the gated cv-parser agent.
    *
-   * Operates on TEXT the caller provides (paste-in / extracted upstream): the
-   * document store is still a mock with no extracted text, and faking it would
-   * violate rule #4. Real file → text extraction (S3 + PDF/DOCX) is a separate,
-   * future phase (rule #9). When a documentId is given, the parse result is
-   * persisted to that document. When a candidateId is given, the parsed
-   * education/languages are additionally promoted onto the Candidate row so
-   * the FIT Engine's experience/education/languages dimensions can read them.
+   * Operates on TEXT the caller provides. Staff paste text by hand; the public
+   * apply flow (portalApplicationService.processCvUpload) extracts it from an
+   * uploaded PDF/DOCX via S3 first. When a documentId is given, the parse
+   * result is persisted to that document. When a candidateId is given, the
+   * parsed education/languages are additionally promoted onto the Candidate
+   * row so the FIT Engine's experience/education/languages dimensions can
+   * read them.
    */
```

- [ ] **Step 6: Type-check, run full candidate + AI test suites, and commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit && npx vitest run tests/candidate tests/ai`
Expected: no type errors; all tests pass (including the unmodified `tests/ai/candidate-ai-parse.test.ts`, confirming the comment-only edit didn't change behavior).

```bash
git add packages/api/src/services/portal-application.service.ts packages/api/src/services/candidate-ai.service.ts tests/candidate/portal-application-service.test.ts
git commit -m "feat(candidate): orchestrate CV fetch, extraction, and parsing for the public apply flow"
```

---

### Task 4: Wire `portal.ts` router — upload URL + apply mutation

**Files:**

- Modify: `packages/api/src/routers/portal.ts`
- Test: `tests/portal/apply-to-vacancy-cv.test.ts`

**Interfaces:**

- Consumes: `createCvUploadPresignedPost` (Task 2), `CV_ALLOWED_CONTENT_TYPES` (Task 1), `portalApplicationService.processCvUpload` (Task 3).
- Produces: `portal.getCvUploadUrl` procedure (input `{ vacancyId, fileName, contentType }`, output `{ url, fields, key }`); `portal.applyToVacancy` gains optional `cvFileKey`/`cvFileName` inputs. Task 6's frontend hook calls `trpc.portal.getCvUploadUrl` and `trpc.portal.applyToVacancy` by these exact names/shapes.

- [ ] **Step 1: Write the failing tests**

Create `tests/portal/apply-to-vacancy-cv.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const VACANCY_ID = '11111111-1111-1111-1111-111111111111';
const ORG_ID = '22222222-2222-2222-2222-222222222222';
const CANDIDATE_ID = '33333333-3333-3333-3333-333333333333';
const STAGE_ID = '44444444-4444-4444-4444-444444444444';
const APPLICATION_ID = '55555555-5555-5555-5555-555555555555';

const dbMocks = {
  vacancy: { findFirstOrThrow: vi.fn() },
  candidate: { upsert: vi.fn() },
  application: { findFirst: vi.fn(), create: vi.fn() },
  pipelineStage: { findFirstOrThrow: vi.fn() },
};

vi.mock('@tims/db', () => ({ db: dbMocks }));

const processCvUploadMock = vi.fn();
vi.mock('../../packages/api/src/services/portal-application.service', () => ({
  portalApplicationService: { processCvUpload: (...a: unknown[]) => processCvUploadMock(...a) },
}));

const createPresignedPostMock = vi.fn();
vi.mock('../../packages/api/src/lib/s3', () => ({
  createCvUploadPresignedPost: (...a: unknown[]) => createPresignedPostMock(...a),
}));

async function makeCaller() {
  const { createCallerFactory, router } = await import('../../packages/api/src/trpc');
  const { portalRouter } = await import('../../packages/api/src/routers/portal');
  const testRouter = router({ portal: portalRouter });
  const callerFactory = createCallerFactory(testRouter);
  return callerFactory({
    user: null,
    headers: new Headers(),
    supabaseAuth: null,
    externalAuth: null,
  } as never) as unknown as {
    portal: {
      applyToVacancy(input: Record<string, unknown>): Promise<{ applicationId: string; candidateId: string }>;
      getCvUploadUrl(input: {
        vacancyId: string;
        fileName: string;
        contentType: string;
      }): Promise<{ url: string; fields: Record<string, string>; key: string }>;
    };
  };
}

const baseApplyInput = {
  vacancyId: VACANCY_ID,
  firstName: 'Ana',
  lastName: 'Gomez',
  email: 'ana@example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.vacancy.findFirstOrThrow.mockResolvedValue({
    id: VACANCY_ID,
    organizationId: ORG_ID,
    stages: [{ id: STAGE_ID, isDefault: true }],
  });
  dbMocks.candidate.upsert.mockResolvedValue({ id: CANDIDATE_ID });
  dbMocks.application.findFirst.mockResolvedValue(null);
  dbMocks.application.create.mockResolvedValue({ id: APPLICATION_ID });
});

describe('portal.applyToVacancy — CV processing', () => {
  it('processes the CV for a new application when cvFileKey is provided', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/org/x.pdf',
      cvFileName: 'resume.pdf',
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, 'cv-uploads/org/x.pdf', 'resume.pdf');
  });

  it('falls back to the key basename when cvFileName is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/org/x.pdf',
    });

    expect(processCvUploadMock).toHaveBeenCalledWith(ORG_ID, CANDIDATE_ID, 'cv-uploads/org/x.pdf', 'x.pdf');
  });

  it('never processes a CV when cvFileKey is omitted', async () => {
    const caller = await makeCaller();
    await caller.portal.applyToVacancy(baseApplyInput);

    expect(processCvUploadMock).not.toHaveBeenCalled();
  });

  it('never re-processes a CV on an idempotent duplicate submit', async () => {
    dbMocks.application.findFirst.mockResolvedValue({ id: APPLICATION_ID });
    const caller = await makeCaller();
    await caller.portal.applyToVacancy({
      ...baseApplyInput,
      cvFileKey: 'cv-uploads/org/x.pdf',
    });

    expect(dbMocks.application.create).not.toHaveBeenCalled();
    expect(processCvUploadMock).not.toHaveBeenCalled();
  });
});

describe('portal.getCvUploadUrl', () => {
  it('resolves the organizationId from the published vacancy and returns the presigned post', async () => {
    createPresignedPostMock.mockResolvedValue({
      url: 'https://s3.example.com',
      fields: { key: 'cv-uploads/org/x.pdf' },
      key: 'cv-uploads/org/x.pdf',
    });
    const caller = await makeCaller();

    const result = await caller.portal.getCvUploadUrl({
      vacancyId: VACANCY_ID,
      fileName: 'resume.pdf',
      contentType: 'application/pdf',
    });

    expect(dbMocks.vacancy.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: VACANCY_ID, status: 'published', deletedAt: null },
      select: { organizationId: true },
    });
    expect(createPresignedPostMock).toHaveBeenCalledWith(ORG_ID, 'application/pdf');
    expect(result.key).toBe('cv-uploads/org/x.pdf');
  });

  it('rejects a content type outside the allowed whitelist', async () => {
    const caller = await makeCaller();

    await expect(
      caller.portal.getCvUploadUrl({
        vacancyId: VACANCY_ID,
        fileName: 'resume.png',
        // @ts-expect-error — intentionally invalid content type
        contentType: 'image/png',
      }),
    ).rejects.toThrow();
    expect(createPresignedPostMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/portal/apply-to-vacancy-cv.test.ts`
Expected: FAIL — `portal.getCvUploadUrl is not a function` / `cvFileKey` not recognized (Zod strips unknown keys, so `processCvUploadMock` is never called and the relevant assertions fail).

- [ ] **Step 3: Add imports to portal.ts**

Edit `packages/api/src/routers/portal.ts:1-5`:

```diff
 import { z } from 'zod';
 import { TRPCError } from '@trpc/server';
 import { router, publicProcedure } from '../trpc';
 import { db } from '@tims/db';
 import { captchaBypassAllowed } from './portal-helpers';
+import { createCvUploadPresignedPost } from '../lib/s3';
+import { CV_ALLOWED_CONTENT_TYPES } from '../lib/cv-extraction';
+import { portalApplicationService } from '../services/portal-application.service';
```

- [ ] **Step 4: Add the `getCvUploadUrl` procedure**

Edit `packages/api/src/routers/portal.ts` — insert immediately after the `getVacancy` procedure (before `applyToVacancy`, i.e. after the closing `}),` of `getVacancy` at what is currently line 128):

```ts
  // Get a presigned S3 POST for the candidate to upload a CV directly, before
  // applying. Server-enforced size cap + content-type via the POST policy's
  // conditions (not merely trusted from the client).
  getCvUploadUrl: publicProcedure
    .input(
      z.object({
        vacancyId: z.string().uuid(),
        fileName: z.string().min(1).max(255),
        contentType: z.enum(CV_ALLOWED_CONTENT_TYPES),
      })
    )
    .mutation(async ({ input }) => {
      const vacancy = await db.vacancy.findFirstOrThrow({
        where: { id: input.vacancyId, status: 'published', deletedAt: null },
        select: { organizationId: true },
      });
      return createCvUploadPresignedPost(vacancy.organizationId, input.contentType);
    }),

```

- [ ] **Step 5: Extend the `applyToVacancy` input schema**

Edit `packages/api/src/routers/portal.ts` (existing lines 145-146):

```diff
         coverLetter: z.string().max(5000).optional(),
+        cvFileKey: z.string().max(500).optional(),
+        cvFileName: z.string().min(1).max(255).optional(),
         captchaToken: z.string().max(4096).optional(),
```

- [ ] **Step 6: Call `processCvUpload` after creating a new application**

Edit `packages/api/src/routers/portal.ts` (existing lines 210-221, inside the `try` block):

```diff
       try {
         const application = await db.application.create({
           data: {
             organizationId: orgId,
             candidateId: candidate.id,
             vacancyId: vacancy.id,
             currentStageId: stageId,
             source: input.source,
             coverLetter: input.coverLetter,
           },
         });
+
+        // Only NEW applications get CV processing — the idempotent-duplicate
+        // early-return above and the P2002 race-catch below intentionally
+        // skip it, so a resubmit never re-runs S3 fetch + extraction + an AI call.
+        if (input.cvFileKey) {
+          await portalApplicationService.processCvUpload(
+            orgId,
+            candidate.id,
+            input.cvFileKey,
+            input.cvFileName ?? input.cvFileKey.split('/').pop() ?? 'cv',
+          );
+        }
+
         return { applicationId: application.id, candidateId: candidate.id };
       } catch (err) {
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/portal/apply-to-vacancy-cv.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Run the full portal + candidate test suites, type-check, and commit**

Run: `npx vitest run tests/portal tests/candidate && pnpm --filter @tims/api exec tsc --noEmit`
Expected: all pass, no type errors. (This confirms the existing `tests/access/endpoint-hardening.test.ts` static check — every `portal.ts` procedure must be `publicProcedure` — still passes, since `getCvUploadUrl` uses `publicProcedure`.)

```bash
git add packages/api/src/routers/portal.ts tests/portal/apply-to-vacancy-cv.test.ts
git commit -m "feat(portal): add CV upload URL endpoint and wire CV processing into applyToVacancy"
```

---

### Task 5: Frontend CV file validation helper

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/cv-validation.ts`
- Test: `tests/portal/cv-validation.test.ts`

**Interfaces:**

- Produces: `validateCvFile(file: File): CvValidationError | null`, `CV_MAX_BYTES: number`, `CV_ALLOWED_MIME_TYPES: readonly string[]`, `type CvValidationError = 'invalid_type' | 'too_large'` — all from `_lib/cv-validation.ts`. Task 6 imports `validateCvFile` and `CvValidationError`.

- [ ] **Step 1: Write the failing test**

Create `tests/portal/cv-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  validateCvFile,
  CV_MAX_BYTES,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/cv-validation';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('validateCvFile', () => {
  it('accepts a PDF under the size cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', 1024);
    expect(validateCvFile(file)).toBeNull();
  });

  it('accepts a DOCX under the size cap', () => {
    const file = makeFile(
      'resume.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      1024,
    );
    expect(validateCvFile(file)).toBeNull();
  });

  it('rejects an unsupported MIME type', () => {
    const file = makeFile('resume.png', 'image/png', 1024);
    expect(validateCvFile(file)).toBe('invalid_type');
  });

  it('rejects a file over the 5MB cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', CV_MAX_BYTES + 1);
    expect(validateCvFile(file)).toBe('too_large');
  });

  it('accepts a file exactly at the size cap', () => {
    const file = makeFile('resume.pdf', 'application/pdf', CV_MAX_BYTES);
    expect(validateCvFile(file)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/portal/cv-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/cv-validation.ts`:

```ts
export const CV_MAX_BYTES = 5 * 1024 * 1024;

export const CV_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export type CvValidationError = 'invalid_type' | 'too_large';

export function validateCvFile(file: File): CvValidationError | null {
  if (!CV_ALLOWED_MIME_TYPES.includes(file.type as (typeof CV_ALLOWED_MIME_TYPES)[number])) {
    return 'invalid_type';
  }
  if (file.size > CV_MAX_BYTES) {
    return 'too_large';
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/portal/cv-validation.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Type-check and commit**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

```bash
git add apps/web/app/"(portal)"/careers/\[orgSlug\]/\[vacancyId\]/_lib/cv-validation.ts tests/portal/cv-validation.test.ts
git commit -m "feat(portal): add client-side CV file validation helper"
```

---

### Task 6: Upload hook + `CvUploadField` component + i18n

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/use-cv-upload.ts`
- Create: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/cv-upload-field.tsx`
- Modify: `apps/web/lib/i18n/es.json`, `apps/web/lib/i18n/en.json`

**Interfaces:**

- Consumes: `validateCvFile`, `CvValidationError` (Task 5); `trpc.portal.getCvUploadUrl` (Task 4).
- Produces: `useCvUpload(vacancyId: string): { file: File | null; error: CvValidationError | 'upload_failed' | null; handleFileChange; removeFile; uploadCvIfNeeded: () => Promise<{ cvFileKey?: string; cvFileName?: string }>; uploading: boolean }` from `_lib/use-cv-upload.ts`; `<CvUploadField file error uploading onFileChange onRemove />` from `_components/cv-upload-field.tsx`. Task 7 consumes both.

This task has no new automated test file — `useCvUpload` is a thin wiring layer over already-tested pieces (`validateCvFile`, `trpc.portal.getCvUploadUrl`), and `CvUploadField` is presentational. It is exercised end-to-end by Task 7's manual verification.

- [ ] **Step 1: Add i18n keys**

Edit `apps/web/lib/i18n/es.json` (line 3235, inside the `"portal"` object, after `teamWillReviewSuffix`):

```diff
     "teamWillReviewPrefix": "El equipo de",
-    "teamWillReviewSuffix": "revisara tu perfil y te contactara si avanzas en el proceso."
+    "teamWillReviewSuffix": "revisara tu perfil y te contactara si avanzas en el proceso.",
+    "cvLabel": "Hoja de vida (opcional)",
+    "cvHelperText": "PDF o Word, maximo 5MB",
+    "cvRemove": "Quitar archivo",
+    "cvInvalidType": "Solo se aceptan archivos PDF o Word (.docx)",
+    "cvTooLarge": "El archivo supera el limite de 5MB",
+    "cvUploadFailed": "No se pudo subir el archivo. Intenta de nuevo o continua sin el."
   },
```

Edit `apps/web/lib/i18n/en.json` (line 3235, same location):

```diff
     "teamWillReviewPrefix": "The",
-    "teamWillReviewSuffix": "team will review your profile and contact you if you advance in the process."
+    "teamWillReviewSuffix": "team will review your profile and contact you if you advance in the process.",
+    "cvLabel": "Resume (optional)",
+    "cvHelperText": "PDF or Word, max 5MB",
+    "cvRemove": "Remove file",
+    "cvInvalidType": "Only PDF or Word (.docx) files are accepted",
+    "cvTooLarge": "File exceeds the 5MB limit",
+    "cvUploadFailed": "Could not upload the file. Try again or continue without it."
   },
```

- [ ] **Step 2: Verify the i18n key-parity test still passes**

Run: `npx vitest run tests/i18n`
Expected: PASS. (`Translations = typeof es` in `apps/web/lib/i18n/index.tsx` means `en.json` must carry the exact same key set — this repo's `tests/i18n` suite is expected to assert that parity. If it fails, the two edits above have mismatched keys — fix before continuing.)

- [ ] **Step 3: Create the upload hook**

Create `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/use-cv-upload.ts`:

```ts
'use client';

import { useState, useCallback } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { validateCvFile, type CvValidationError } from './cv-validation';

type CvUploadError = CvValidationError | 'upload_failed';

interface UseCvUploadResult {
  file: File | null;
  error: CvUploadError | null;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removeFile: () => void;
  uploadCvIfNeeded: () => Promise<{ cvFileKey?: string; cvFileName?: string }>;
  uploading: boolean;
}

export function useCvUpload(vacancyId: string): UseCvUploadResult {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<CvUploadError | null>(null);
  const [uploading, setUploading] = useState(false);
  const getUploadUrlMutation = trpc.portal.getCvUploadUrl.useMutation();

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!selected) return;
    const validationError = validateCvFile(selected);
    if (validationError) {
      setError(validationError);
      setFile(null);
      return;
    }
    setError(null);
    setFile(selected);
  }, []);

  const removeFile = useCallback(() => {
    setFile(null);
    setError(null);
  }, []);

  const uploadCvIfNeeded = useCallback(async (): Promise<{ cvFileKey?: string; cvFileName?: string }> => {
    if (!file) return {};
    setUploading(true);
    try {
      const { url, fields, key } = await getUploadUrlMutation.mutateAsync({
        vacancyId,
        fileName: file.name,
        contentType: file.type as
          | 'application/pdf'
          | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const formData = new FormData();
      Object.entries(fields).forEach(([k, v]) => formData.append(k, v));
      formData.append('file', file);
      const uploadRes = await fetch(url, { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('S3 upload failed');
      return { cvFileKey: key, cvFileName: file.name };
    } catch {
      setError('upload_failed');
      throw new Error('cv_upload_failed');
    } finally {
      setUploading(false);
    }
  }, [file, getUploadUrlMutation, vacancyId]);

  return { file, error, handleFileChange, removeFile, uploadCvIfNeeded, uploading };
}
```

- [ ] **Step 4: Create the `CvUploadField` component**

Create `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/cv-upload-field.tsx`:

```tsx
'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { CvValidationError } from '../_lib/cv-validation';

interface CvUploadFieldProps {
  file: File | null;
  error: CvValidationError | 'upload_failed' | null;
  uploading: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

const ERROR_KEYS = {
  invalid_type: 'cvInvalidType',
  too_large: 'cvTooLarge',
  upload_failed: 'cvUploadFailed',
} as const;

export function CvUploadField({ file, error, uploading, onFileChange, onRemove }: CvUploadFieldProps) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div>
      <label className="block text-xs font-medium text-[#585858] mb-1">{p.cvLabel}</label>
      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-[#EDEDED] px-3 py-2 text-sm text-[#333]">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={uploading}
            className="ml-2 shrink-0 text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
          >
            {p.cvRemove}
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          onChange={onFileChange}
          disabled={uploading}
          className="block w-full text-sm text-[#585858] file:mr-3 file:rounded-lg file:border-0 file:bg-[#F6F6F6] file:px-3 file:py-2 file:text-[12px] file:font-medium file:text-[#1F114C] disabled:opacity-50"
        />
      )}
      <p className="mt-1 text-[10px] text-[#8B8B8B]">{p.cvHelperText}</p>
      {error && <p className="mt-1 text-[11px] text-[#DD0C15]">{p[ERROR_KEYS[error]]}</p>}
    </div>
  );
}
```

- [ ] **Step 5: Type-check and commit**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors (both new files are unused so far — that's expected; Task 7 wires them in).

```bash
git add apps/web/lib/i18n/es.json apps/web/lib/i18n/en.json "apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/use-cv-upload.ts" "apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/cv-upload-field.tsx"
git commit -m "feat(portal): add CV upload hook, field component, and i18n copy"
```

---

### Task 7: Wire CV upload into the apply modal

**Files:**

- Create: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/experience-levels.ts`
- Create: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step2.tsx`
- Modify: `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal.tsx`

**Interfaces:**

- Consumes: `useCvUpload`, `CvUploadField` (Task 6).
- Produces: nothing new consumed by later tasks — this is the final integration point.

`apply-modal.tsx` is 295 lines today; adding the CV upload wiring inline would push it over the 300-line component cap (CLAUDE.md). This task extracts "Step 2" of the wizard (professional info + cover letter) into its own subcomponent first, which both makes room and gives the new `CvUploadField` a natural home next to the cover letter field it visually sits beside.

- [ ] **Step 1: Extract the `EXPERIENCE_LEVELS` constant**

`apply-modal.tsx` step 2 (the select) and step 3 (the summary lookup) both need this array — it must live somewhere both the new subcomponent and the parent can import.

Create `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/experience-levels.ts`:

```ts
export const EXPERIENCE_LEVELS = [
  { value: '', label: 'Seleccionar...' },
  { value: '0', label: 'Sin experiencia' },
  { value: '1', label: '1 ano' },
  { value: '2', label: '2 anos' },
  { value: '3', label: '3-4 anos' },
  { value: '5', label: '5-7 anos' },
  { value: '8', label: '8-10 anos' },
  { value: '12', label: '10+ anos' },
];
```

- [ ] **Step 2: Create the `ApplyModalStep2` subcomponent**

Create `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step2.tsx`:

```tsx
'use client';

import { CvUploadField } from './cv-upload-field';
import { useI18n } from '../../../../../../lib/i18n';
import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';
import type { CvValidationError } from '../_lib/cv-validation';

const inputCls =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls =
  'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none disabled:opacity-50';

interface ApplyModalStep2Props {
  currentTitle: string;
  setCurrentTitle: (v: string) => void;
  currentCompany: string;
  setCurrentCompany: (v: string) => void;
  yearsExperience: string;
  setYearsExperience: (v: string) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
  coverLetter: string;
  setCoverLetter: (v: string) => void;
  cvFile: File | null;
  cvError: CvValidationError | 'upload_failed' | null;
  cvUploading: boolean;
  onCvFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCvRemove: () => void;
}

export function ApplyModalStep2({
  currentTitle,
  setCurrentTitle,
  currentCompany,
  setCurrentCompany,
  yearsExperience,
  setYearsExperience,
  linkedinUrl,
  setLinkedinUrl,
  coverLetter,
  setCoverLetter,
  cvFile,
  cvError,
  cvUploading,
  onCvFileChange,
  onCvRemove,
}: ApplyModalStep2Props) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.currentTitleLabel}</label>
          <input
            type="text"
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentTitlePlaceholder}
          />
        </div>
        <div>
          <label className={labelCls}>{p.currentCompanyLabel}</label>
          <input
            type="text"
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentCompanyPlaceholder}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.yearsExpLabel}</label>
          <select
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            className={`${inputCls} bg-white`}
          >
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>LinkedIn</label>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            maxLength={2048}
            className={inputCls}
            placeholder="https://linkedin.com/in/tu-perfil"
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>{p.coverLetterLabel}</label>
        <textarea
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          maxLength={5000}
          rows={5}
          className={textareaCls}
          placeholder={p.coverLetterPlaceholder}
        />
        <p className="mt-1 text-right text-[10px] text-[#8B8B8B]">{coverLetter.length}/5000</p>
      </div>
      <CvUploadField
        file={cvFile}
        error={cvError}
        uploading={cvUploading}
        onFileChange={onCvFileChange}
        onRemove={onCvRemove}
      />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apply-modal.tsx`**

This step replaces the whole file. Read the current file at `apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal.tsx` first — it is 295 lines — then apply these changes:

1. Imports (top of file): add `import { ApplyModalStep2 } from './apply-modal-step2';`, `import { useCvUpload } from '../_lib/use-cv-upload';`, `import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';`.
2. Delete the local `const EXPERIENCE_LEVELS = [...]` array (currently lines 19-28) — now imported instead.
3. Delete the local `const inputCls`, `labelCls`, `textareaCls` constants (currently lines 30-32) if, after step 5 below, they are no longer referenced anywhere in this file (step 3's JSX still uses `inputCls`/`labelCls` for its own inputs — keep them; they moved into `apply-modal-step2.tsx` as a separate copy, which is intentional: two short, independently-editable 1-line Tailwind class strings duplicated across two files is not worth a shared module).
4. Inside the component body, after the existing `const [captchaToken, setCaptchaToken] = useState<string | null>(null);` line, add: `const cv = useCvUpload(vacancyId);`.
5. Replace the `{step === 2 && ( ... )}` block (currently lines 168-206) with:
   ```tsx
   {
     step === 2 && (
       <ApplyModalStep2
         currentTitle={currentTitle}
         setCurrentTitle={setCurrentTitle}
         currentCompany={currentCompany}
         setCurrentCompany={setCurrentCompany}
         yearsExperience={yearsExperience}
         setYearsExperience={setYearsExperience}
         linkedinUrl={linkedinUrl}
         setLinkedinUrl={setLinkedinUrl}
         coverLetter={coverLetter}
         setCoverLetter={setCoverLetter}
         cvFile={cv.file}
         cvError={cv.error}
         cvUploading={cv.uploading}
         onCvFileChange={cv.handleFileChange}
         onCvRemove={cv.removeFile}
       />
     );
   }
   ```
6. Replace `handleSubmit` (currently lines 61-90) with:
   ```tsx
   const handleSubmit = async () => {
     if (!isStep1Valid) return;
     setSubmitting(true);
     try {
       const { cvFileKey, cvFileName } = await cv.uploadCvIfNeeded();
       await applyMutation.mutateAsync({
         vacancyId,
         firstName: firstName.trim(),
         lastName: lastName.trim(),
         email: email.trim(),
         phone: phone.trim() || undefined,
         location: location.trim() || undefined,
         currentTitle: currentTitle.trim() || undefined,
         currentCompany: currentCompany.trim() || undefined,
         yearsExperience: yearsExperience ? parseInt(yearsExperience) : undefined,
         linkedinUrl: linkedinUrl.trim() || undefined,
         coverLetter: coverLetter.trim() || undefined,
         cvFileKey,
         cvFileName,
         captchaToken: captchaToken ?? undefined,
         source: 'portal',
       });
       setSuccess(true);
     } catch (err) {
       if (err instanceof Error && err.message === 'cv_upload_failed') {
         toast(p.cvUploadFailed, { type: 'error' });
         setSubmitting(false);
         return;
       }
       const msg = err instanceof Error ? err.message : 'Error al enviar la aplicacion';
       if (msg.includes('unique') || msg.includes('Unique') || msg.includes('already')) {
         toast(p.applyModalDuplicateError, { type: 'error' });
       } else {
         toast(msg, { type: 'error' });
       }
       setSubmitting(false);
     }
   };
   ```
7. Everything else (step 1 JSX, step 3 JSX including the `EXPERIENCE_LEVELS.find(...)` summary lookup, the navigation footer, `SummaryRow`) is unchanged.

After this edit the file should be roughly 265-275 lines — well under the 300-line cap.

- [ ] **Step 4: Type-check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including `tests/portal/*` and `tests/candidate/*` from earlier tasks.

- [ ] **Step 6: Manual browser verification**

Per CLAUDE.md, verify the golden path and edge cases in a real browser before calling this done:

Run: `cd apps/web && pnpm dev`

1. Navigate to a published vacancy's public apply page, open the modal, advance to step 2.
2. Confirm the CV field renders with helper text, select a real small PDF — filename should appear with a "remove" option.
3. Try selecting a `.png` — confirm the inline `cvInvalidType` error shows and the file is not accepted.
4. Complete the form through step 3 and submit **without CV_UPLOADS_BUCKET configured locally** — confirm the application still submits successfully and the success screen shows (this is the "S3 fails, application still succeeds" path, since `getCvUploadUrl` will throw and `uploadCvIfNeeded` surfaces `cvUploadFailed` — confirm that toast appears and the candidate can retry or clear the file and resubmit without one).
5. If `CV_UPLOADS_BUCKET`/AWS credentials are available locally, repeat with a real upload and confirm no errors in the server console.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_lib/experience-levels.ts" "apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal-step2.tsx" "apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal.tsx"
git commit -m "feat(portal): wire CV upload into the public apply modal"
```

---

## Post-implementation notes (not code tasks)

- **`CV_UPLOADS_BUCKET`** (and the S3 bucket itself, with the CORS policy described in the spec) must be created and set as an env var in Vercel before this goes live — infra/ops work outside this plan's scope, same category as the AWS credential/ops items already tracked as Federico-only.
- Follow-up issue for malware/AV scanning was explicitly deferred per the design spec — file it separately when picking this back up, don't fold it into this plan's scope.
