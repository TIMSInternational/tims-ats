// Badge style + label for each stored vacancy status. One map for the list, the detail header and the
// SLA card, so no screen falls back to printing the raw slug ("approved").
export interface VacancyStatusLabels {
  statusDraft: string;
  statusPendingApproval: string;
  statusApproved: string;
  statusPublished: string;
  statusClosed: string;
  statusFrozen: string;
}

export function vacancyStatusMap(labels: VacancyStatusLabels): Record<string, { cls: string; label: string }> {
  return {
    draft: { cls: 'bg-gray-100 text-gray-600', label: labels.statusDraft },
    pending_approval: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: labels.statusPendingApproval },
    approved: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: labels.statusApproved },
    published: { cls: 'bg-green-50 text-green-600 border border-green-200', label: labels.statusPublished },
    closed: { cls: 'bg-red-50 text-red-600', label: labels.statusClosed },
    frozen: { cls: 'bg-purple-50 text-purple-600 border border-purple-200', label: labels.statusFrozen },
  };
}

export function vacancyStatusLabel(status: string, labels: VacancyStatusLabels): string {
  return vacancyStatusMap(labels)[status]?.label ?? status.replace(/_/g, ' ');
}
