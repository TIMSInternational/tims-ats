'use client';

import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n/index';
import { Skeleton } from '../../../../../components';
import { ApprovalChain } from './approval-chain';
import { OfferTimeline } from './offer-timeline';
import { OfferValidations } from './offer-validations';
import { OfferLetterModal } from './offer-letter-modal';
import { SigningLinkModal } from './signing-link-modal';
import { OFFER_STATUS_LABEL } from './offer-detail-view.helpers';
import { CandidateHeader, OfferCard } from './offer-detail-view.parts';
import { useState } from 'react';

interface OfferDetailViewProps {
  offerId: string;
  onBack: () => void;
}

export function OfferDetailView({ offerId, onBack }: OfferDetailViewProps) {
  const { t } = useI18n();
  const offer = trpc.offer.getById.useQuery({ id: offerId });
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [showSigningModal, setShowSigningModal] = useState(false);
  const [signingUrl, setSigningUrl] = useState('');

  const generateSigningLink = trpc.offer.generateSigningLink.useMutation({
    onSuccess: (data) => {
      setSigningUrl(window.location.origin + data.signingUrl);
      setShowSigningModal(true);
      offer.refetch();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
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
        <button onClick={onBack} className="mt-3 text-[13px] text-[#1F114C] hover:underline">{t.offers.backToList}</button>
      </div>
    );
  }

  const o = offer.data;
  const statusInfo = OFFER_STATUS_LABEL[o.status] ?? OFFER_STATUS_LABEL.draft;
  const validations = o.validations ?? [];
  const legalChecks = (o.legalChecks ?? []) as Array<{ id: string; checkName: string; completed: boolean; completedAt: Date | string | null; completedByUser: { id: string; firstName: string; lastName: string } | null }>;
  const completedValidations = validations.filter((v) => v.status === 'passed').length;
  const totalValidations = validations.length || 6;
  const progressPct = totalValidations > 0 ? (completedValidations / totalValidations) * 100 : 0;
  const allComplete = completedValidations === totalValidations && totalValidations > 0;
  const benefits = o.benefits as Record<string, string> | null;
  const benefitList = benefits ? Object.values(benefits) : [];
  const terms = o.terms as Record<string, string> | null;

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="flex items-center gap-1.5 text-[13px] text-[#8B8B8B] hover:text-[#585858] transition">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
        {t.offers.backToList}
      </button>

      <CandidateHeader
        offer={o}
        statusLabel={statusInfo.label}
        completedValidations={completedValidations}
        totalValidations={totalValidations}
        progressPct={progressPct}
        allComplete={allComplete}
        onViewLetter={() => setShowLetterModal(true)}
        onSendForSigning={() => generateSigningLink.mutate({ offerId })}
        isGeneratingLink={generateSigningLink.isPending}
      />

      {/* Two columns */}
      <div className="flex flex-col md:flex-row gap-6">
        {/* LEFT: Offer details 55% */}
        <div className="w-full md:flex-[55] space-y-4">
          <OfferCard
            offer={o}
            statusInfo={statusInfo}
            benefitList={benefitList}
            terms={terms}
          />
          <ApprovalChain approvals={o.approvals ?? []} />
          <OfferTimeline offer={o} />
        </div>

        {/* RIGHT: Validations 45% */}
        <div className="w-full md:flex-[45]">
          <OfferValidations
            offerId={offerId}
            validations={validations}
            legalChecks={legalChecks}
          />
        </div>
      </div>

      {/* Offer Letter Modal */}
      {showLetterModal && (
        <OfferLetterModal
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
          onClose={() => setShowSigningModal(false)}
        />
      )}
    </div>
  );
}
