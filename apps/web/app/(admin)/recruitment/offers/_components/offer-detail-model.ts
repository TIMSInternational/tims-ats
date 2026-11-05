// What the offer detail may show and do, from the offer and the viewer's grants. Pure (no React), so the
// rules are unit-tested. Server checks stay authoritative; this only keeps buttons honest:
//  - "Enviar para Firma" is shown only to viewers who may send, and says why it is disabled (B-17);
//  - "Autorizar contratación" explains a filled vacancy before anyone clicks (F-15);
//  - edit / withdraw / "Crear nueva oferta" follow the offer's state (B-02, B-04);
//  - the pre-employment ring and column are hidden when the offer has no checks (B-20).

import { displayOfferStatus, isWithdrawableOffer } from '@tims/shared';

export type OfferDetailGrants = { canCreate: boolean; canUpdate: boolean; canApprove: boolean };

export type OfferDetailInput = {
  status: string;
  expiresAt?: Date | string | null;
  validationsTotal: number;
  legalChecksTotal: number;
  blockingValidationOpen: boolean;
  legalCheckOpen: boolean;
  /** Converted offers of the vacancy and its positions (offer.getById vacancy._count / positions). */
  vacancyHires?: number;
  vacancyPositions?: number;
  applicationStatus?: string | null;
};

export type OfferDetailReasons = {
  sendForSignatureNeedsApproval: string;
  sendForSignatureResendRestricted: string;
  hireBlockedValidations: string;
  hireBlockedLegal: string;
  hireBlockedVacancyFilled: string;
};

export type OfferDetailModel = {
  displayStatus: string;
  sendForSigning: { visible: boolean; enabled: boolean; reason?: string };
  hire: { visible: boolean; enabled: boolean; reason?: string };
  canEdit: boolean;
  canWithdraw: boolean;
  canCreateNew: boolean;
  showValidations: boolean;
};

const SENDABLE_STATUSES = ['draft', 'pending_approval', 'approved', 'sent'];
const ENDED_STATUSES = ['rejected', 'declined', 'withdrawn', 'expired'];

export function offerDetailModel(
  offer: OfferDetailInput,
  grants: OfferDetailGrants,
  reasons: OfferDetailReasons,
  now: Date = new Date(),
): OfferDetailModel {
  const displayStatus = displayOfferStatus(offer, now);
  const canRequest = grants.canCreate || grants.canUpdate;

  let sendForSigning: OfferDetailModel['sendForSigning'] = { visible: false, enabled: false };
  if (canRequest && SENDABLE_STATUSES.includes(displayStatus)) {
    if (displayStatus === 'approved') sendForSigning = { visible: true, enabled: true };
    else if (displayStatus === 'sent') {
      // Re-sending re-emails the live bearer link, which the server allows only to offer:update.
      sendForSigning = grants.canUpdate
        ? { visible: true, enabled: true }
        : { visible: true, enabled: false, reason: reasons.sendForSignatureResendRestricted };
    } else sendForSigning = { visible: true, enabled: false, reason: reasons.sendForSignatureNeedsApproval };
  }

  const vacancyFilled =
    offer.vacancyHires !== undefined &&
    offer.vacancyPositions !== undefined &&
    offer.vacancyHires >= Math.max(1, offer.vacancyPositions);
  const hireReason = offer.blockingValidationOpen
    ? reasons.hireBlockedValidations
    : offer.legalCheckOpen
      ? reasons.hireBlockedLegal
      : vacancyFilled
        ? reasons.hireBlockedVacancyFilled
        : undefined;
  const hireVisible = offer.status === 'accepted' && grants.canApprove;

  return {
    displayStatus,
    sendForSigning,
    hire: { visible: hireVisible, enabled: hireVisible && hireReason === undefined, reason: hireReason },
    canEdit: offer.status === 'draft' && canRequest,
    canWithdraw: canRequest && isWithdrawableOffer(offer),
    canCreateNew: grants.canCreate && ENDED_STATUSES.includes(displayStatus) && offer.applicationStatus === 'active',
    showValidations: offer.validationsTotal + offer.legalChecksTotal > 0,
  };
}
