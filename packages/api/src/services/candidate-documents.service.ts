import { TRPCError } from '@trpc/server';
import { candidateRepository } from '../repositories/candidate.repository';
import { candidateService } from './candidate.service';

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

  async deleteDocument(orgId: string, documentId: string) {
    const doc = await candidateRepository.findDocument(orgId, documentId);
    if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    await candidateRepository.deleteDocument(documentId);
    return { success: true };
  },
};
