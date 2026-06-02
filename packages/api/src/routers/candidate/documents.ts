import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';

export const candidateDocumentsRouter = router({
  uploadDocument: permissionProcedure('candidate', 'update')
    .input(z.object({
      candidateId: z.string().uuid(),
      type: z.string().min(1).max(50),
      fileName: z.string().min(1).max(255),
      fileSize: z.number().int().min(0).max(52428800).optional(),
    }))
    .mutation(({ ctx, input }) =>
      candidateService.uploadDocument(ctx.user.organizationId, input.candidateId, input.type, input.fileName, input.fileSize),
    ),

  deleteDocument: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      candidateService.deleteDocument(ctx.user.organizationId, input.documentId),
    ),

  parseCV: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(({ ctx, input }) =>
      candidateService.parseCV(ctx.user.organizationId, input.documentId),
    ),
});
