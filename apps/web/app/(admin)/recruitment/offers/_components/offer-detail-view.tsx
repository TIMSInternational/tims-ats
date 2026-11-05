'use client';

import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { describeOfferActionError } from '../../../../../lib/offer-action-error';
import { useI18n } from '../../../../../lib/i18n/index';
import { Skeleton } from '../../../../../components';
import { ApprovalChain } from './approval-chain';
import { OfferTimeline } from './offer-timeline';
import { OfferValidations } from './offer-validations';
import { OfferLetterModal } from './offer-letter-modal';
import { HireConfirmationModal } from './hire-confirmation-modal';
import { SigningLinkModal } from './signing-link-modal';
import { OfferApprovalActions } from './offer-approval-actions';
import { offerStatusBadge } from './offer-detail-view.helpers';
import { CandidateHeader, OfferCard } from './offer-detail-view.parts';
import { offerDetailModel } from './offer-detail-model';
import { OfferManageActions } from './offer-manage-actions';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCan } from '../../../../../lib/permissions';
import { invalidateAfterHire } from './invalidate-after-hire';

interface OfferDetailViewProps {
  offerId: string;
  onBack: () => void;
}

export function OfferDetailView({ offerId, onBack }: OfferDetailViewProps) {
  const { t } = useI18n();
  const router = useRouter();
  const can = useCan();
  const utils = trpc.useUtils();
  const offer = trpc.offer.getById.useQuery(
    { id: offerId },
    {
      // The candidate accepts in another session. Refresh when staff return to this offer,
      // while it is awaiting a decision, or when the window regains focus.
      refetchOnMount: 'always',
      refetchInterval: (query) => (query.state.data?.status === 'sent' ? 30_000 : false),
      refetchOnWindowFocus: (query) => (query.state.data?.status === 'sent' ? 'always' : false),
    },
  );
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [signingUrl, setSigningUrl] = useState('');
  const [emailDeliveryAccepted, setEmailDeliveryAccepted] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [showHireConfirmation, setShowHireConfirmation] = useState(false);

  const convertToEmployee = trpc.offer.convertToEmployee.useMutation({
    onSuccess: async () => {
      setShowHireConfirmation(false);
      toast(t.offers.hiringAuthorized, { type: 'success' });
      await invalidateAfterHire(utils, offerId);
    },
    // B-21: hire errors go through the same mapping as every other offer action (no raw server text).
    onError: (error) =>
      toast(
        describeOfferActionError(error, {
          forbidden: t.offers.errorForbiddenAction,
          generic: t.offers.errorOfferAction,
        }),
        { type: 'error' },
      ),
  });
  const [signingError, setSigningError] = useState<string | null>(null);

  const generateSigningLink = trpc.offer.generateSigningLink.useMutation({
    onMutate: () => setSigningError(null),
    onSuccess: (data) => {
      setSigningUrl(data.signingUrl ? window.location.origin + data.signingUrl : '');
      setEmailDeliveryAccepted(data.emailDeliveryAccepted);
      setRecipientEmail(data.candidateEmail);
      setShowSigningModal(true);
      offer.refetch();
    },
    onError: (err) => {
      const message = describeOfferActionError(err, {
        forbidden: t.offers.errorForbiddenAction,
        generic: t.offers.errorOfferAction,
      });
      setSigningError(message);
      toast(message, { type: 'error' });
    },
  });

  if (offer.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="flex flex-col md:flex-row gap-6">
          <Skeleton className="w-full md:flex-[55] h-64 rounded-xl" />
          <Skeleton className="w-full md:flex-[45] h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (offer.error || !offer.data) {
    return (
      <div className="text-center py-16">
        <p className="text-[#8B8B8B] text-sm">{t.offers.notFound}</p>
        <button onClick={onBack} className="mt-3 text-[13px] text-[#1F114C] hover:underline">
          {t.offers.backToList}
        </button>
      </div>
    );
  }

  const o = offer.data;
  const validations = o.validations ?? [];
  const legalChecks = (o.legalChecks ?? []) as Array<{
    id: string;
    checkName: string;
    completed: boolean;
    completedAt: Date | string | null;
    completedByUser: { id: string; firstName: string; lastName: string } | null;
  }>;
  const completedValidations = validations.filter((v) => v.status === 'passed' || v.status === 'waived').length;
  const totalValidations = validations.length;
  const progressPct = totalValidations > 0 ? (completedValidations / totalValidations) * 100 : 0;
  const blockingValidationOpen = validations.some(
    (v) => v.isBlocking && v.status !== 'passed' && v.status !== 'waived',
  );
  const legalCheckOpen = legalChecks.some((check) => !check.completed);
  const model = offerDetailModel(
    {
      status: o.status,
      expiresAt: o.expiresAt,
      validationsTotal: totalValidations,
      legalChecksTotal: legalChecks.length,
      blockingValidationOpen,
      legalCheckOpen,
      vacancyHires: o.vacancy._count?.offers,
      vacancyPositions: o.vacancy.positions,
      applicationStatus: o.application?.status ?? null,
    },
    { canCreate: can('offer', 'create'), canUpdate: can('offer', 'update'), canApprove: can('offer', 'approve') },
    t.offers,
  );
  const statusInfo = offerStatusBadge(model.displayStatus, t.offers);
  const refetchOffer = () => {
    void offer.refetch();
  };
  const benefits = o.benefits as Record<string, string> | null;
  const benefitList = benefits ? Object.values(benefits) : [];
  const terms = o.terms as Record<string, string> | null;

  return (
    <div className="space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-[#8B8B8B] hover:text-[#585858] transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {t.offers.backToList}
      </button>

      <CandidateHeader
        offer={o}
        statusLabel={statusInfo.label}
        completedValidations={completedValidations}
        totalValidations={totalValidations}
        progressPct={progressPct}
        showValidations={model.showValidations}
        canAuthorize={model.hire.enabled}
        authorizationReason={model.hire.reason}
        showHireAction={model.hire.visible}
        isConverted={o.status === 'converted'}
        isAuthorizing={convertToEmployee.isPending}
        onAuthorize={() => setShowHireConfirmation(true)}
        onViewOnboarding={can('onboarding', 'read') ? () => router.push('/people/onboarding') : undefined}
        onViewLetter={() => setShowLetterModal(true)}
        onSendForSigning={() => generateSigningLink.mutate({ offerId })}
        isGeneratingLink={generateSigningLink.isPending}
        sendForSigning={model.sendForSigning}
        manageActions={
          <OfferManageActions
            offer={{
              id: o.id,
              status: o.status,
              candidateId: o.candidate.id,
              applicationId: o.application?.id ?? null,
              vacancy: o.vacancy,
              salary: o.salary,
              currency: o.currency,
              startDate: o.startDate,
              contractType: o.contractType,
              terms: o.terms,
              benefits: o.benefits,
            }}
            canEdit={model.canEdit}
            canWithdraw={model.canWithdraw}
            canCreateNew={model.canCreateNew}
            onChanged={refetchOffer}
          />
        }
      />
      {signingError && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-700">
          {signingError}
        </p>
      )}

      {/* Two columns */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* LEFT: Offer details 55% (full width when the offer has no pre-employment checks, B-20) */}
        <div className={`w-full space-y-4 ${model.showValidations ? 'md:flex-[55]' : ''}`}>
          <OfferCard offer={o} statusInfo={statusInfo} benefitList={benefitList} terms={terms} />
          <ApprovalChain approvals={o.approvals ?? []} />
          <OfferApprovalActions
            offerId={offerId}
            status={o.status}
            approvals={o.approvals ?? []}
            onUpdated={refetchOffer}
          />
          <OfferTimeline offer={o} />
        </div>

        {/* RIGHT: Validations 45% */}
        {model.showValidations && (
          <div className="w-full md:flex-[45]">
            <OfferValidations
              offerId={offerId}
              validations={validations}
              legalChecks={legalChecks}
              readOnly={o.status === 'converted'}
            />
          </div>
        )}
      </div>

      {/* Offer Letter Modal */}
      {showLetterModal && (
        <OfferLetterModal
          companyName={o.organization.name}
          offer={{
            candidate: o.candidate,
            vacancy: o.vacancy,
            salary: o.salary,
            currency: o.currency,
            startDate: o.startDate,
            contractType: o.contractType,
            benefits,
            terms,
            createdAt: o.createdAt,
          }}
          onClose={() => setShowLetterModal(false)}
        />
      )}

      {/* Signing Link Modal */}
      {showSigningModal && (
        <SigningLinkModal
          signingUrl={signingUrl}
          emailDeliveryAccepted={emailDeliveryAccepted}
          recipientEmail={recipientEmail}
          onClose={() => setShowSigningModal(false)}
        />
      )}

      {showHireConfirmation && (
        <HireConfirmationModal
          candidateName={`${o.candidate.firstName} ${o.candidate.lastName}`}
          accessEmail={o.candidate.email}
          startDate={o.startDate}
          initialJobTitle={o.vacancy.title}
          isPending={convertToEmployee.isPending}
          onClose={() => setShowHireConfirmation(false)}
          onConfirm={(jobTitle) => convertToEmployee.mutate({ offerId, jobTitle })}
        />
      )}
    </div>
  );
}
