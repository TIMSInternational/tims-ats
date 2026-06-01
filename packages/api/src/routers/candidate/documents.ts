import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';
import { db } from '@tims/db';
import { TRPCError } from '@trpc/server';

export const candidateDocumentsRouter = router({
  // 6.5 — Upload document (stub — returns mock)
  uploadDocument: permissionProcedure('candidate', 'update')
    .input(
      z.object({
        candidateId: z.string().uuid(),
        type: z.string().min(1),
        fileName: z.string().min(1),
        fileSize: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Stub: in production this would generate a pre-signed S3 URL
      const mockUrl = `https://storage.tims.app/${ctx.user.organizationId}/${input.candidateId}/${input.fileName}`;

      const doc = await db.candidateDocument.create({
        data: {
          organizationId: ctx.user.organizationId,
          candidateId: input.candidateId,
          type: input.type,
          fileName: input.fileName,
          fileUrl: mockUrl,
          fileSize: input.fileSize,
        },
      });

      return { document: doc, uploadUrl: mockUrl };
    }),

  // 6.6 — Delete document
  deleteDocument: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await db.candidateDocument.findFirst({
        where: { id: input.documentId, organizationId: ctx.user.organizationId },
      });
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      }

      await db.candidateDocument.delete({ where: { id: input.documentId } });
      return { success: true };
    }),

  // 6.7 — Parse CV (stub — mock AI)
  parseCV: permissionProcedure('candidate', 'update')
    .input(z.object({ documentId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await db.candidateDocument.findFirst({
        where: { id: input.documentId, organizationId: ctx.user.organizationId },
      });
      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
      }

      // Stub: mock AI-parsed data
      const parsedData = {
        extractedName: 'Juan Perez',
        extractedEmail: 'juan@example.com',
        extractedPhone: '+57 300 123 4567',
        extractedSkills: ['JavaScript', 'React', 'Node.js'],
        extractedExperience: [
          { company: 'Acme Corp', title: 'Software Engineer', years: 3 },
        ],
        extractedEducation: [
          { institution: 'Universidad Nacional', degree: 'Ingenieria de Sistemas', year: 2020 },
        ],
        confidence: 0.87,
        modelVersion: 'bedrock-claude-v1-stub',
      };

      await db.candidateDocument.update({
        where: { id: input.documentId },
        data: { parsedData },
      });

      return parsedData;
    }),
});
