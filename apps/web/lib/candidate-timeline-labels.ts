// Renders a candidate history event (candidate.getTimeline) in the viewer's language. The API returns the
// event `type` plus raw `params`; the words, the source label and the document type all come from i18n
// here, so the 360 "Actividad" never shows "Applied to …", "Source: portal" or a bare "cv".
//
// Pure module (no React) so node tests can exercise it.
import { candidateSourceLabel, type CandidateSourceLabels } from './candidate-labels';
import { rejectionReasonLabel } from './reject-reasons';

export interface TimelineEventInput {
  type: string;
  title: string;
  description: string | null;
  params?: {
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
}

export interface TimelineLabels extends CandidateSourceLabels {
  timelineApplied: string;
  timelineSource: string;
  timelineRejected: string;
  timelineStageStart: string;
  timelineAssessmentAssigned: string;
  timelineAssessmentCompleted: string;
  timelineAssessmentStatus: string;
  timelineStatusPending: string;
  timelineStatusInProgress: string;
  timelineStatusCompleted: string;
  timelineStatusExpired: string;
  timelineScore: string;
  timelineDocumentUploaded: string;
  timelineDocumentTypeCv: string;
  timelineDocumentTypeOther: string;
}

/** `{name}`-style placeholders; a function replacer so `$&` in user data is never interpreted. */
function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

function statusLabel(status: string, l: TimelineLabels): string {
  switch (status) {
    case 'pending':
      return l.timelineStatusPending;
    case 'in_progress':
      return l.timelineStatusInProgress;
    case 'completed':
      return l.timelineStatusCompleted;
    case 'expired':
      return l.timelineStatusExpired;
    default:
      return status.replace(/_/g, ' ');
  }
}

export function localizeTimelineEvent(
  event: TimelineEventInput,
  l: TimelineLabels,
  /** rejectCandidateModal.reasons: the stored "<CODE>: <label>" reason is shown in the viewer's language. */
  reasonLabels: Record<string, string> = {},
): { title: string; description: string | null } {
  const p = event.params;
  if (!p) return { title: event.title, description: event.description };
  switch (event.type) {
    case 'application':
      return {
        title: fill(l.timelineApplied, { vacancy: p.vacancyTitle ?? '' }),
        description: p.source ? fill(l.timelineSource, { source: candidateSourceLabel(p.source, l) }) : null,
      };
    case 'application_rejected':
      return {
        title: fill(l.timelineRejected, { vacancy: p.vacancyTitle ?? '' }),
        description: rejectionReasonLabel(p.reason, reasonLabels) || null,
      };
    case 'stage_movement':
      return {
        title: `${p.fromStage ?? l.timelineStageStart} → ${p.toStage ?? ''}`,
        description: p.reason ?? null,
      };
    case 'assessment_assigned':
      return {
        title: fill(l.timelineAssessmentAssigned, { name: p.assessmentName ?? '' }),
        description: p.status ? fill(l.timelineAssessmentStatus, { status: statusLabel(p.status, l) }) : null,
      };
    case 'assessment_completed':
      return {
        title: fill(l.timelineAssessmentCompleted, { name: p.assessmentName ?? '' }),
        description: p.score != null ? fill(l.timelineScore, { score: String(p.score) }) : null,
      };
    case 'document_uploaded':
      return {
        title: fill(l.timelineDocumentUploaded, { name: p.fileName ?? '' }),
        description: p.documentType === 'cv' ? l.timelineDocumentTypeCv : l.timelineDocumentTypeOther,
      };
    default:
      return { title: event.title, description: event.description };
  }
}
