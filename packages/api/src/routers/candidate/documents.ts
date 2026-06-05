import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { candidateService } from '../../services/candidate.service';
import { candidateAiService } from '../../services/candidate-ai.service';

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

  // Parses CV TEXT (paste-in / extracted upstream) via the gated cv-parser
  // agent. Optionally persists the result to a document. Real file→text
  // extraction (S3 + PDF/DOCX) is a separate future phase.
  parseCV: permissionProcedure('candidate', 'update')
    .input(z.object({
      text: z.string().min(1).max(20000),
      documentId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) =>
      candidateAiService.parseCV(ctx.user.organizationId, input.text, input.documentId),
    ),
});
