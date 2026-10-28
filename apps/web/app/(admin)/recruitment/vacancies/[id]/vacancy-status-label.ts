/**
 * Maps a stored vacancy status (a free `String` column) to its translated label.
 * Unknown/legacy values are shown as stored rather than hidden.
 */
export interface VacancyStatusLabels {
  statusDraft: string;
  statusPendingApproval: string;
  statusApproved: string;
  statusPublished: string;
  statusClosed: string;
  statusFrozen: string;
}

export function vacancyStatusLabel(status: string, labels: VacancyStatusLabels): string {
  switch (status) {
    case 'draft':
      return labels.statusDraft;
    case 'pending_approval':
      return labels.statusPendingApproval;
    case 'approved':
      return labels.statusApproved;
    case 'published':
      return labels.statusPublished;
    case 'closed':
      return labels.statusClosed;
    case 'frozen':
      return labels.statusFrozen;
    default:
      return status;
  }
}
