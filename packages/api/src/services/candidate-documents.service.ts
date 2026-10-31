import { TRPCError } from '@trpc/server';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateService } from './candidate.service';
import { logDataAccess } from '../access/audit';
import { createCvDownloadUrl, cvKeyExtensionForOrg, CV_DOWNLOAD_URL_TTL_SECONDS } from '../lib/s3';

// ---------------------------------------------------------------------------
// Candidate Documents Service — document CRUD, no db imports.
// Split from candidate.service.ts (CLAUDE.md 300-line service cap).
// ---------------------------------------------------------------------------

export const candidateDocumentsService = {
  // This staff-side upload path is still a mock (fabricates fileUrl, never accepts real
  // bytes) — unlike the public apply flow's real S3 upload (portalApplicationService,
  // packages/api/src/routers/portal.ts), which is out of scope for this staff path.
  async uploadDocument(orgId: string, candidateId: string, type: string, fileName: string, fileSize?: number) {
    await candidateService.verifyExists(orgId, candidateId);
    const mockUrl = `https://storage.tims.app/${orgId}/${candidateId}/${fileName}`;
    const doc = await candidateRepository.createDocument(orgId, {
      candidateId,
      type,
      fileName,
      fileUrl: mockUrl,
      fileSize,
    });
    return { document: doc, uploadUrl: mockUrl };
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
    // Rows written by the mock staff upload (uploadDocument) hold a non-S3 URL; legacy or tampered keys may sit
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
