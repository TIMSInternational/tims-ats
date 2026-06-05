import { TRPCError } from '@trpc/server';
import { parseCV as parseCVAgent } from '@tims/ai';
import { candidateRepository } from '../repositories/candidate.repository';

// ---------------------------------------------------------------------------
// Candidate AI service — the candidate-domain entry points that call AI.
//
// Kept separate from candidate.service.ts because (a) it touches AI + PII, which
// CLAUDE.md §7 / rule #7 require to live behind a dedicated service, and (b) the
// core service is already at the 300-line limit. Every call here goes through
// the gated @tims/ai agents (budget → cache → PII → bedrock → validate → log);
// this layer never imports the AI SDK or talks to the model directly (rule #2).
// ---------------------------------------------------------------------------

export const candidateAiService = {
  /**
   * Parse CV text into structured candidate data via the gated cv-parser agent.
   *
   * Operates on TEXT the caller provides (paste-in / extracted upstream): the
   * document store is still a mock with no extracted text, and faking it would
   * violate rule #4. Real file → text extraction (S3 + PDF/DOCX) is a separate,
   * future phase (rule #9). When a documentId is given, the parse result is
   * persisted to that document.
   */
  async parseCV(orgId: string, text: string, documentId?: string) {
    // Verify document ownership BEFORE spending an AI call on it.
    if (documentId) {
      const doc = await candidateRepository.findDocument(orgId, documentId);
      if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'Documento no encontrado' });
    }

    const { data, model, confidence } = await parseCVAgent(orgId, text);

    const parsedData = {
      name: data.name,
      email: data.email,
      phone: data.phone,
      skills: data.skills,
      experience: data.experience,
      education: data.education,
      languages: data.languages,
      summary: data.summary,
      confidence,
      modelVersion: model,
      parsed: true,
    };

    if (documentId) {
      await candidateRepository.updateDocumentParsedData(documentId, parsedData);
    }

    return parsedData;
  },
};
