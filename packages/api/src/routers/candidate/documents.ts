import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { candidateAiService } from '../../services/candidate-ai.service';
import { assertScoped } from '../../access';

export const candidateDocumentsRouter = router({
  uploadDocument: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      type: z.string().min(1).max(50),
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().min(0).max(52428800).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertScoped('candidate', input.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.uploadDocument(ctx.user.organizationId, input.candidateId, input.type, input.fileName, input.fileSize);
    }),

  deleteDocument: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await candidateService.getDocument(ctx.user.organizationId, input.documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      await assertScoped('candidate', doc.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      return candidateService.deleteDocument(ctx.user.organizationId, input.documentId);
    }),

  // Parses CV TEXT (paste-in / extracted upstream) via the gated cv-parser
  // agent. Optionally persists the result to a document. Real file→text
  // extraction (S3 + PDF/DOCX) is a separate future phase.
  parseCV: permissionProcedure('candidate', 'update')
    .input(z.object({
      text: z.string().min(1).max(20000),
      documentId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (input.documentId) {
        const doc = await candidateService.getDocument(ctx.user.organizationId, input.documentId);
        if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
        await assertScoped('candidate', doc.candidateId, ctx.access, ctx.user.id, ctx.user.organizationId);
      }
      return candidateAiService.parseCV(ctx.user.organizationId, input.text, input.documentId);
    }),
});
