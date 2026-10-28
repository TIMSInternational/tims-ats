import type es from '../../../../lib/i18n/es.json';

type DataRequestMessages = (typeof es)['dataSubjectRequests'];

/** Translated label of a data-subject request type. */
export function requestTypeLabel(requestType: string, m: DataRequestMessages): string {
  return requestType === 'deletion' ? m.typeDeletion : m.typeOther;
}

/** Translated label of the channel a request arrived through. */
export function requestSourceLabel(source: string, m: DataRequestMessages): string {
  if (source === 'staff') return m.sourceStaff;
  if (source === 'candidate_portal') return m.sourceCandidatePortal;
  return m.sourceOther;
}

/** A request is overdue once its computed due date is in the past. */
export function isRequestOverdue(dueAt: string, now: number = Date.now()): boolean {
  return new Date(dueAt).getTime() < now;
}
