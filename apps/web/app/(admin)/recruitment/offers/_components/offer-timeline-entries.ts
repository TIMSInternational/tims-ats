// The offer history, built from data already on the offer (Pilot UX audit B-19, proof-run F-14):
//  - candidate answers are dated by `respondedAt` (they used `sentAt`), and an acceptance stays in the
//    history after the hire is recorded (status 'converted');
//  - each approval request, approval and approver rejection (with its reason) is an entry;
//  - expiry, withdrawal (who and why) and the recorded hire are entries.
// Pure: labels and the date formatter are passed in.

import { displayOfferStatus } from '@tims/shared';

type Person = { firstName: string; lastName: string };
type DateLike = Date | string | null | undefined;

export type TimelineOffer = {
  status: string;
  sentAt: DateLike;
  respondedAt?: DateLike;
  expiresAt?: DateLike;
  createdAt: DateLike;
  settings?: unknown;
  creator: Person | null;
  approvals: Array<{
    status: string;
    createdAt?: DateLike;
    decidedAt: DateLike;
    comment?: string | null;
    approver: Person;
  }>;
  hirePrediction?: { createdAt: DateLike; hiredBy: Person | null } | null;
};

export type TimelineLabels = {
  timelineCreated: string;
  timelineSystem: string;
  timelineApprovalRequested: string;
  timelineApproved: string;
  timelineRejected: string;
  timelineReason: string;
  timelineSent: string;
  timelineAccepted: string;
  timelineDeclined: string;
  timelineExpired: string;
  timelineWithdrawn: string;
  timelineWithdrawnNoName: string;
  timelineHired: string;
  timelineHiredNoName: string;
  approvalDecisionComment: string;
};

export type TimelineTone = 'brand' | 'info' | 'success' | 'danger' | 'muted';

export type TimelineEntry = { tone: TimelineTone; title: string; detail?: string; at: DateLike };

const fullName = (person: Person | null | undefined) => (person ? `${person.firstName} ${person.lastName}`.trim() : '');

function settingString(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function time(at: DateLike): number {
  if (!at) return Number.NaN;
  return new Date(at).getTime();
}

/** Entries newest first. Undated entries keep their place in the lifecycle. */
export function buildOfferTimeline(
  offer: TimelineOffer,
  labels: TimelineLabels,
  now: Date = new Date(),
): TimelineEntry[] {
  const chronological: TimelineEntry[] = [];
  const creator = fullName(offer.creator) || labels.timelineSystem;
  chronological.push({ tone: 'brand', title: labels.timelineCreated.replace('{name}', creator), at: offer.createdAt });

  const approvals = [...offer.approvals].sort((a, b) => (time(a.createdAt) || 0) - (time(b.createdAt) || 0));
  for (const approval of approvals) {
    const name = fullName(approval.approver);
    if (approval.createdAt) {
      chronological.push({
        tone: 'muted',
        title: labels.timelineApprovalRequested.replace('{name}', name),
        at: approval.createdAt,
      });
    }
    const comment = approval.comment?.trim() || undefined;
    if (approval.status === 'approved') {
      chronological.push({
        tone: 'success',
        title: labels.timelineApproved.replace('{name}', name),
        detail: comment ? labels.approvalDecisionComment.replace('{comment}', comment) : undefined,
        at: approval.decidedAt,
      });
    } else if (approval.status === 'rejected') {
      chronological.push({
        tone: 'danger',
        title: labels.timelineRejected.replace('{name}', name),
        detail: comment ? labels.timelineReason.replace('{reason}', comment) : undefined,
        at: approval.decidedAt,
      });
    }
  }

  if (offer.sentAt) chronological.push({ tone: 'info', title: labels.timelineSent, at: offer.sentAt });

  const status = displayOfferStatus({ status: offer.status, expiresAt: offer.expiresAt }, now);
  if (status === 'accepted' || status === 'converted') {
    chronological.push({ tone: 'success', title: labels.timelineAccepted, at: offer.respondedAt });
  } else if (status === 'declined') {
    chronological.push({ tone: 'danger', title: labels.timelineDeclined, at: offer.respondedAt });
  } else if (status === 'expired') {
    chronological.push({ tone: 'muted', title: labels.timelineExpired, at: offer.expiresAt });
  } else if (status === 'withdrawn') {
    const by = settingString(offer.settings, 'withdrawnByName');
    const reason = settingString(offer.settings, 'withdrawnReason');
    chronological.push({
      tone: 'muted',
      title: by ? labels.timelineWithdrawn.replace('{name}', by) : labels.timelineWithdrawnNoName,
      detail: reason ? labels.timelineReason.replace('{reason}', reason) : undefined,
      at: settingString(offer.settings, 'withdrawnAt'),
    });
  }
  if (status === 'converted') {
    const by = fullName(offer.hirePrediction?.hiredBy);
    chronological.push({
      tone: 'success',
      title: by ? labels.timelineHired.replace('{name}', by) : labels.timelineHiredNoName,
      at: offer.hirePrediction?.createdAt,
    });
  }

  // Undated entries take the time of the entry before them, so a stable sort keeps them in lifecycle order.
  let carried = Number.NEGATIVE_INFINITY;
  const keyed = chronological.map((entry, index) => {
    const t = time(entry.at);
    if (!Number.isNaN(t)) carried = Math.max(carried, t);
    return { entry, index, key: Number.isNaN(t) ? carried : t };
  });
  keyed.sort((a, b) => a.key - b.key || a.index - b.index);
  return keyed.map((item) => item.entry).reverse();
}
