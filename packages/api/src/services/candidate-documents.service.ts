import { TRPCError } from '@trpc/server';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateService } from './candidate.service';
import { logDataAccess } from '../access/audit';
import {
  createCvDownloadUrl,
  createCvUploadPresignedPost,
  cvKeyExtensionForOrg,
  cvObjectHead,
  CV_DOWNLOAD_URL_TTL_SECONDS,
  CV_MAX_BYTES,
} from '../lib/s3';
import type { CvContentType } from '../lib/cv-extraction';
import type { StaffDocumentType } from '@tims/shared';
import { consentGuard } from './consent-guard.service';

// ---------------------------------------------------------------------------
// Candidate Documents Service — document CRUD, no db imports.
// Split from candidate.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const candidateDocumentsService = {
  // Staff upload (A-21), the same presigned S3 path the public apply flow uses: getUploadUrl issues a
  // presigned POST into the org's own `cv-uploads/<orgId>/` prefix (S3 enforces the content type and the
  // 5 MB cap), the browser posts the file there, then uploadDocument records it. A key outside the org's
  // prefix, or one with no object behind it, is refused — it could never be opened with getDocumentUrl.
  async getUploadUrl(orgId: string, candidateId: string, contentType: CvContentType) {
    await candidateService.verifyExists(orgId, candidateId);
    // #312: no new documents for a candidate who revoked the data-processing authorization.
    await consentGuard.assertActive(orgId, candidateId);
    // The POST policy pins this candidate on the object (see UPLOAD_CANDIDATE_METADATA).
    return createCvUploadPresignedPost(orgId, contentType, { candidateId });
  },

  async uploadDocument(orgId: string, candidateId: string, type: StaffDocumentType, fileName: string, fileKey: string) {
    await candidateService.verifyExists(orgId, candidateId);
    await consentGuard.assertActive(orgId, candidateId);
    if (!cvKeyExtensionForOrg(orgId, fileKey)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'document_key_invalid' });
    }
    // A key already on record (another candidate's file, or this upload recorded twice) is never re-attached.
    if (await candidateRepository.findDocumentByFileKey(orgId, fileKey)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'document_key_invalid' });
    }
    let head: { sizeBytes: number; candidateId: string | null } | null = null;
    try {
      head = await cvObjectHead(fileKey);
    } catch {
      head = null;
    }
    if (!head || head.sizeBytes <= 0 || head.sizeBytes > CV_MAX_BYTES) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'document_upload_missing' });
    }
    // Only the candidate the upload URL was issued for: the pinned metadata is part of the signed POST policy.
    if (head.candidateId !== candidateId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'document_key_invalid' });
    }
    return candidateRepository.createDocument(orgId, {
      candidateId,
      type,
      fileName,
      fileUrl: fileKey,
      fileSize: head.sizeBytes,
    });
  },

  async getDocument(orgId: string, documentId: string) {
    return candidateRepository.findDocument(orgId, documentId);
  },

  /**
   * Short-lived signed link to a candidate's stored file, for staff. The caller has already passed the
   * candidate permission + scope checks. The document must belong to BOTH this candidate and this org,
   * and its stored key must sit inside the org's upload prefix — anything else is never signed.
   * Every issued link writes a data_access_logs row first, fail-closed: no audit row, no link.
   */
  async getDocumentDownloadUrl(
    orgId: string,
    candidateId: string,
    documentId: string,
    actor: { actorId: string; ipAddress: string | null; userAgent: string | null },
  ) {
    const doc = await candidateRepository.findCandidateDocumentFile(orgId, candidateId, documentId);
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    // Rows written by the former mock staff upload hold a non-S3 URL; legacy or tampered keys may sit
    // outside the org prefix. Neither has a file this org may read.
    if (!cvKeyExtensionForOrg(orgId, doc.fileUrl)) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'document_file_unavailable' });
    }
    await logDataAccess(
      {
        organizationId: orgId,
        actorId: actor.actorId,
        entity: 'candidateDocument',
        recordId: doc.id,
        action: 'read',
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
      { failClosed: true },
    );
    const url = await createCvDownloadUrl(orgId, doc.fileUrl, doc.fileName);
    return { url, expiresInSeconds: CV_DOWNLOAD_URL_TTL_SECONDS };
  },

  async deleteDocument(orgId: string, documentId: string) {
    const doc = await candidateRepository.findDocument(orgId, documentId);
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    await candidateRepository.deleteDocument(documentId);
    return { success: true };
  },
};
