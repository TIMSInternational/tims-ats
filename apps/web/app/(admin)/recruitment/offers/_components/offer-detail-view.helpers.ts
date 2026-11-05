import { offerStatusLabel, type OfferStatusLabels } from '../../../../../lib/offer-status';

// Badge colours on the dark offer-card header. Labels come from i18n (lib/offer-status.ts): a status missing
// here used to fall back to "Borrador" (B-02: a rejected offer read as a draft).
const OFFER_STATUS_STYLE: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-300' },
  pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-300' },
  approved: { bg: 'bg-blue-500/20', text: 'text-blue-300' },
  sent: { bg: 'bg-violet-500/20', text: 'text-violet-300' },
  accepted: { bg: 'bg-green-500/20', text: 'text-green-300' },
  converted: { bg: 'bg-green-600/20', text: 'text-green-300' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-300' },
  declined: { bg: 'bg-red-500/20', text: 'text-red-300' },
  expired: { bg: 'bg-gray-500/20', text: 'text-gray-300' },
  withdrawn: { bg: 'bg-gray-500/20', text: 'text-gray-300' },
};

const NEUTRAL = { bg: 'bg-gray-500/20', text: 'text-gray-300' };

export function offerStatusBadge(
  status: string,
  labels: OfferStatusLabels,
): { bg: string; text: string; label: string } {
  return { ...(OFFER_STATUS_STYLE[status] ?? NEUTRAL), label: offerStatusLabel(status, labels) };
}
