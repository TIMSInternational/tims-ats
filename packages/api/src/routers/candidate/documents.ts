import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../../trpc';
import { candidateDocumentsService } from '../../services/candidate-documents.service';
import { candidateAiService } from '../../services/candidate-ai.service';
import { assertScoped } from '../../access';

export const candidateDocumentsRouter = router({
  uploadDocument: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        type: z.string().min(1).max(50),
        fileName: z.string().min(1).max(255),
        fileSize: z.number().int().min(0).max(52428800).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateDocumentsService.uploadDocument(
        ctx.user.organizationId,
        input.candidateId,
        input.type,
        input.fileName,
        input.fileSize,
      );
    }),

  deleteDocument: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await candidateDocumentsService.getDocument(ctx.user.organizationId, input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      await assertScoped('candidate', doc.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateDocumentsService.deleteDocument(ctx.user.organizationId, input.documentId);
    }),

  // Parses CV TEXT the staff member pastes in, via the gated cv-parser agent.
  // Optionally persists the result to a document, and always promotes the
  // parsed education/languages onto the owning Candidate row (so the FIT
  // Engine's education/languages dimensions can read them — see
  // candidateAiService.parseCV). Real file→text extraction (S3 + PDF/DOCX) is
  // done on the public apply flow instead — see
  // portalApplicationService.processCvUpload — which is public-portal-only
  // and does not go through this staff-authenticated router.
  parseCV: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        text: z.string().min(1).max(20000),
        documentId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      if (input.documentId) {
        const doc = await candidateDocumentsService.getDocument(ctx.user.organizationId, input.documentId);
        if (!doc || doc.candidateId !== input.candidateId) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
        }
      }
      return candidateAiService.parseCV(ctx.user.organizationId, input.text, input.documentId, input.candidateId);
    }),
});
