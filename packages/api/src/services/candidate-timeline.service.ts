import type { Prisma } from '@tims/db';
import { candidateRepository } from '../repositories/candidate.repository';

// ---------------------------------------------------------------------------
// Candidate timeline ("Actividad" on the Candidate 360) — split from candidate.service.ts (300-line cap).
// ---------------------------------------------------------------------------

/** application id → "Nombre Apellido" of whoever rejected it (newest rejection audit row wins). */
export async function rejectionAuthorsById(orgId: string, applicationIds: string[]): Promise<Map<string, string>> {
  const authors = new Map<string, string>();
  if (applicationIds.length === 0) return authors;
  const rows = await candidateRepository.findRejectionAuthors(orgId, applicationIds);
  for (const row of rows) {
    if (!row.entityId || authors.has(row.entityId) || !row.user) continue;
    authors.set(row.entityId, `${row.user.firstName} ${row.user.lastName}`.trim());
  }
  return authors;
}

export const candidateTimelineService = {
  async getTimeline(orgId: string, candidateId: string, appScopeWhere: Prisma.ApplicationWhereInput) {
    const [applications, assessments, documents] = await candidateRepository.getTimelineData(
      orgId,
      candidateId,
      appScopeWhere,
    );

    // `title`/`description` are a Spanish fallback; screens render the event from `type` + `params`
    // through i18n (apps/web/lib/candidate-timeline-labels.ts), so slugs and English never show (A-04).
    type TimelineEvent = {
      id: string;
      type:
        | 'application'
        | 'stage_movement'
        | 'application_rejected'
        | 'assessment_assigned'
        | 'assessment_completed'
        | 'document_uploaded';
      title: string;
      description: string | null;
      date: Date;
      actor: string | null;
      params: {
        vacancyTitle?: string;
        source?: string;
        fromStage?: string | null;
        toStage?: string;
        reason?: string | null;
        assessmentName?: string;
        status?: string;
        score?: number | null;
        fileName?: string;
        documentType?: string;
      };
    };

    const events: TimelineEvent[] = [];
    const rejectionAuthors = await rejectionAuthorsById(
      orgId,
      applications.filter((a) => a.rejectedAt).map((a) => a.id),
    );

    for (const app of applications) {
      if (app.rejectedAt) {
        // The rejection is part of the candidate's history (A-05): reason and who, never the internal note.
        events.push({
          id: `rej-${app.id}`,
          type: 'application_rejected',
          title: `Descartado en ${app.vacancy.title}`,
          description: app.rejectedReason,
          date: app.rejectedAt,
          actor: rejectionAuthors.get(app.id) ?? null,
          params: { vacancyTitle: app.vacancy.title, reason: app.rejectedReason },
        });
      }
      events.push({
        id: `app-${app.id}`,
        type: 'application',
        title: `Se postuló a ${app.vacancy.title}`,
        description: `Fuente: ${app.source}`,
        date: app.appliedAt,
        actor: null,
        params: { vacancyTitle: app.vacancy.title, source: app.source },
      });
      for (const mov of app.movements) {
        events.push({
          id: `mov-${mov.id}`,
          type: 'stage_movement',
          title: `${mov.fromStage?.name ?? 'Inicio'} → ${mov.toStage.name}`,
          description: mov.reason,
          date: mov.movedAt,
          actor: mov.actor ? `${mov.actor.firstName} ${mov.actor.lastName}` : null,
          params: { fromStage: mov.fromStage?.name ?? null, toStage: mov.toStage.name, reason: mov.reason },
        });
      }
    }

    for (const a of assessments) {
      events.push({
        id: `asn-${a.id}`,
        type: 'assessment_assigned',
        title: `Evaluación asignada: ${a.assessmentType.name}`,
        description: `Estado: ${a.status}`,
        date: a.assignedAt,
        actor: null,
        params: { assessmentName: a.assessmentType.name, status: a.status },
      });
      if (a.completedAt) {
        const score = a.result?.normalizedScore ?? null;
        events.push({
          id: `asc-${a.id}`,
          type: 'assessment_completed',
          title: `Evaluación completada: ${a.assessmentType.name}`,
          description: score != null ? `Puntaje: ${score}` : null,
          date: a.completedAt,
          actor: null,
          params: { assessmentName: a.assessmentType.name, score: score != null ? Number(score) : null },
        });
      }
    }

    for (const doc of documents) {
      events.push({
        id: `doc-${doc.id}`,
        type: 'document_uploaded',
        title: `Documento subido: ${doc.fileName}`,
        description: doc.type,
        date: doc.uploadedAt,
        actor: null,
        params: { fileName: doc.fileName, documentType: doc.type },
      });
    }

    events.sort((a, b) => b.date.getTime() - a.date.getTime());
    return events;
  },
};
