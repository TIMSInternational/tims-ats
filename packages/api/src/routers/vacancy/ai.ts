import { z } from 'zod';
import { router, permissionProcedure } from '../../trpc';

export const vacancyAiRouter = router({
  // 4.11 — Generate description (AI stub)
  generateDescription: permissionProcedure('vacancy', 'create')
    .input(z.object({
      title: z.string().min(1),
      context: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      // Stub — will be replaced with AWS Bedrock call
      return {
        description: `## ${input.title}\n\nEstamos buscando un profesional talentoso para unirse a nuestro equipo como **${input.title}**.\n\n### Responsabilidades\n- Liderar iniciativas clave del area\n- Colaborar con equipos multifuncionales\n- Contribuir al crecimiento de la organizacion\n\n### Requisitos\n- Experiencia relevante en el area\n- Habilidades de comunicacion efectiva\n- Orientacion a resultados\n\n### Beneficios\n- Salario competitivo\n- Desarrollo profesional continuo\n- Ambiente de trabajo colaborativo`,
        model: 'stub',
        tokensUsed: 0,
      };
    }),

  // 4.12 — Check inclusive language (AI stub)
  checkInclusiveLanguage: permissionProcedure('vacancy', 'read')
    .input(z.object({ text: z.string().min(1) }))
    .mutation(async ({ input }) => {
      // Stub — will be replaced with AWS Bedrock call
      return {
        score: 85,
        suggestions: [
          { original: 'candidato', suggestion: 'persona candidata', reason: 'Lenguaje de genero neutro' },
        ],
        model: 'stub',
      };
    }),
});
