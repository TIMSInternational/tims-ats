# Candidate CV Upload + Real Extraction Design

> Status: APPROVED (Federico, 2026-07-30, conversational approval — see brainstorming
> session). Closes GitHub issue #251.

## Context

The public careers apply flow (`apps/web/app/(portal)/careers/[orgSlug]/[vacancyId]/_components/apply-modal.tsx`
→ `trpc.portal.applyToVacancy`, `packages/api/src/routers/portal.ts`, unauthenticated
`publicProcedure`) is 100% text-only today — there is no file field anywhere in its Zod
input. Meanwhile `parseCV(orgId, cvText)` (`packages/ai/src/agents/cv-parser.ts:57`) is
fully built and wired for staff, who paste CV text by hand
(`recruitment/candidates/[id]/cv-parse-card.tsx` → `candidate.parseCV` →
`candidateAiService.parseCV`), but it has never been fed a real uploaded file. The
`CandidateDocument` Prisma model already exists with the right shape
(`packages/db/prisma/schema/candidate.prisma:42-60`), but the only mutation that writes to
it, `uploadDocument` (`candidate.service.ts:243-248`), is a fake — it never accepts file
bytes, just stores a fabricated `mockUrl` string. No S3 usage exists anywhere in the repo,
though a real AWS account with credentials already exists for SES email
(`packages/api/src/lib/ses.ts`). No PDF/DOCX extraction library is installed. This closes
that entire gap for the public apply flow: candidates can now attach a real CV, and it gets
extracted and parsed automatically.

## Decisions from brainstorming

1. **CV upload is optional** on the public apply form — matches the existing optional
   cover-letter field, doesn't block candidates without a file ready.
2. **`parseCV` auto-runs immediately** after extraction, no staff action needed. Accepted
   cost: one AI call per application submitted with a CV.
3. **Upload via presigned S3 URL**, not proxied through a tRPC mutation — avoids
   payload-size/base64-inflation concerns on Vercel functions.
4. **Extraction + parsing run synchronously** inside the `applyToVacancy` mutation, not as a
   background job. Deliberately does not pull in Trigger.dev worker infra (`workers/` is an
   unbuilt one-line stub — that's separate roadmap item #252). A few extra seconds of
   apply-submit latency is an accepted tradeoff, and matches the existing staff-side
   `parseCV` call, which is already synchronous.
5. **File constraints: PDF + DOCX only, 5MB cap.**
6. **Malware/AV scanning is explicitly deferred** to a follow-up issue. v1 security posture:
   private S3 bucket, signed-GET-only access, the existing Cloudflare Turnstile captcha
   already gating this endpoint, and the size/MIME bounds below. The file is never executed
   or rendered server-side, so the residual risk is low.
7. **Scoped to the public portal apply flow only.** The separate staff-authenticated apply
   path (`candidate/timeline.ts` → `candidateService.applyToVacancy`) is untouched — staff
   already have the manual paste-text `parseCV` UI, so there's no functionality gap left
   there.

## Architecture & data flow

1. **New public procedure `portal.getCvUploadUrl`** (`publicProcedure`, unauthenticated,
   same trust tier as the rest of the apply flow) — input `{ vacancyId, fileName,
contentType }`. Looks up the vacancy to resolve `organizationId` (also implicitly
   confirms the vacancy exists and is open, same as `applyToVacancy` does today), validates
   `contentType` against a whitelist (`application/pdf`,
   `application/vnd.openxmlformats-officedocument.wordprocessingml.document`), and returns a
   **presigned S3 POST** (via `@aws-sdk/s3-presigned-post`'s `createPresignedPost`, not a
   raw PUT). A POST policy supports a `content-length-range` condition, so both the 5MB cap
   and the content-type are enforced by S3 itself at upload time — not merely trusted from
   the client. Object key: `cv-uploads/{orgId}/{uuid}.{ext}`, org-scoped for tenant
   separation at the storage layer too. Presigned POST expires after 5 minutes.
2. Client (`apply-modal.tsx`) gets one new optional file input alongside the existing
   cover-letter field. On file select, the client checks size/type locally for fast
   feedback. On submit (if a file was selected): request the presigned POST, upload directly
   to S3 with the returned fields, then include the resulting `cvFileKey` in the
   `applyToVacancy` payload. No file bytes ever transit our own server.
3. `portal.applyToVacancy`'s Zod input gains one new optional field:
   `cvFileKey: z.string().max(500).optional()`.
4. Server-side, after the existing Candidate/Application creation logic: if `cvFileKey` is
   present, the service:
   - `HeadObject`s the key to confirm it exists and re-checks size server-side (defense
     against a client that bypassed or lied about the local check).
   - `GetObject`s the bytes.
   - Extracts text: `pdf-parse` for `.pdf`, `mammoth` for `.docx`.
   - Truncates to 8000 chars (matches `parseCV`'s existing input contract).
   - Creates a `CandidateDocument` row (`type: 'cv'`, `fileUrl: cvFileKey` — storing the S3
     key, not a signed URL, since the bucket is private and nothing currently renders
     `fileUrl` as a clickable link; a future "staff downloads the CV" feature would generate
     a signed GET URL on demand from this key — out of scope here).
   - Calls the existing `candidateAiService.parseCV(orgId, text, documentId, candidateId)`
     unchanged — it already persists `parsedData` on the document and promotes
     education/languages onto the `Candidate` row.

## Error handling

The entire CV-processing block (HeadObject → extract → parseCV) is wrapped so that **any
failure inside it is logged and swallowed, never surfaced as an application failure** — a
candidate must never see "application failed" because their PDF was malformed or password
-protected. If the upload itself succeeded but extraction/parsing throws, the
`CandidateDocument` row is still created (so staff can see a file was submitted) just
without `parsedData`. Client-side, if the direct-to-S3 upload fails (network blip, expired
presigned POST), show an inline error with a retry option — since the field is optional, the
candidate can also just proceed without attaching a CV.

## New dependencies & infra

- `pdf-parse` and `mammoth` for text extraction — will verify both on npmjs.com before
  running `pnpm add`, per CLAUDE.md's slopsquatting check.
- `@aws-sdk/client-s3` + `@aws-sdk/s3-presigned-post` — reuses the AWS account/credentials
  already configured for SES; just needs S3 permissions added.
- One new private S3 bucket (or a scoped prefix in an existing bucket, decided during
  implementation), versioning off, no public access/ACLs, CORS configured to allow direct
  browser `POST` from the app's origin(s).

## Testing

- Unit tests for the extraction functions: malformed/empty/corrupt file input produces a
  clean thrown error (not a hang or silent wrong output), covering both the PDF and DOCX
  paths.
- Unit tests for the size/MIME validation logic in `getCvUploadUrl`.
- Service-level test for `applyToVacancy` with `cvFileKey` set, covering: happy path
  (`CandidateDocument` created with `parsedData` populated, education/languages promoted
  onto `Candidate`) and the extraction-throws-but-application-still-succeeds path (no
  `parsedData`, application still created, no error surfaced to the caller).
- No new visual-regression concerns beyond one added optional file input in an existing
  modal step.

## Out of scope

- Staff-authenticated apply path (`candidate/timeline.ts`) — untouched.
- Malware/antivirus scanning — follow-up issue.
- Background/async processing via Trigger.dev — separate roadmap item #252.
- Staff UI for downloading/viewing the uploaded CV file (signed GET URL generation) — the
  document row and S3 key exist for this to be built later, but no consumer is built here.
- Any change to the existing staff-side paste-text `parseCV` flow.
