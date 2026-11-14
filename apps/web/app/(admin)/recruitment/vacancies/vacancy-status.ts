import type { StatusMapEntry } from '../../../../components';

// Badge tone + label for each stored vacancy status. One map for the list, the detail header and the
// SLA card, so no screen falls back to printing the raw slug ("approved"). Tones follow foundation §12:
// "Cerrada" is a normal end state (neutral), not an error; colour is never the only signal (the word is shown).
export interface VacancyStatusLabels {
  statusDraft: string;
  statusPendingApproval: string;
  statusApproved: string;
  statusPublished: string;
  statusClosed: string;
  statusFrozen: string;
}

export function vacancyStatusMap(labels: VacancyStatusLabels): Record<string, StatusMapEntry> {
  return {
    draft: { tone: 'neutral', label: labels.statusDraft },
    pending_approval: { tone: 'warning', label: labels.statusPendingApproval },
    approved: { tone: 'brand', label: labels.statusApproved },
    published: { tone: 'success', label: labels.statusPublished },
    closed: { tone: 'neutral', label: labels.statusClosed },
    frozen: { tone: 'info', label: labels.statusFrozen },
  };
}

export function vacancyStatusLabel(status: string, labels: VacancyStatusLabels): string {
  return vacancyStatusMap(labels)[status]?.label ?? status.replace(/_/g, ' ');
}

/** Decorative dot beside the priority word (the word carries the meaning; the dot is never alone). */
export const VACANCY_PRIORITY_DOT: Record<string, string> = {
  low: 'bg-muted',
  medium: 'bg-info',
  high: 'bg-warning',
  urgent: 'bg-brand-red',
};
