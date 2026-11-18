import type { StatusTone } from '../../../../../components/status-badge';
import { offerStatusLabel, type OfferStatusLabels } from '../../../../../lib/offer-status';

// One tone per offer status (foundation-spec.md §12), shared by the list and the detail header so a status
// always looks the same. Labels come from i18n (lib/offer-status.ts): a status missing here used to fall back
// to "Borrador" (B-02: a rejected offer read as a draft); an unknown one is neutral.
export const OFFER_STATUS_TONES: Record<string, StatusTone> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'info',
  sent: 'brand',
  accepted: 'success',
  converted: 'success',
  rejected: 'danger',
  declined: 'danger',
  expired: 'neutral',
  withdrawn: 'neutral',
};

export function offerStatusBadge(status: string, labels: OfferStatusLabels): { tone: StatusTone; label: string } {
  return { tone: OFFER_STATUS_TONES[status] ?? 'neutral', label: offerStatusLabel(status, labels) };
}
