'use client';

import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n/index';
import { Skeleton } from '../../../../../components';
import { CandidateAvatar } from '../../../../../components';
import { formatCurrency, formatDate } from '../../../../../lib/format-utils';
import { ApprovalChain } from './approval-chain';
import { OfferTimeline } from './offer-timeline';
import { OfferValidations } from './offer-validations';

interface OfferDetailViewProps {
  offerId: string;
  onBack: () => void;
}

const OFFER_STATUS_LABEL: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-500/20', text: 'text-gray-300', label: 'Borrador' },
  pending_approval: { bg: 'bg-amber-500/20', text: 'text-amber-300', label: 'Pendiente' },
  approved: { bg: 'bg-blue-500/20', text: 'text-blue-300', label: 'Aprobada' },
  sent: { bg: 'bg-violet-500/20', text: 'text-violet-300', label: 'Enviada' },
  accepted: { bg: 'bg-green-500/20', text: 'text-green-300', label: 'Oferta Aceptada' },
  declined: { bg: 'bg-red-500/20', text: 'text-red-300', label: 'Rechazada' },
};

export function OfferDetailView({ offerId, onBack }: OfferDetailViewProps) {
  const { t } = useI18n();

  const offer = trpc.offer.getById.useQuery({ id: offerId });

  if (offer.isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="flex gap-6">
          <Skeleton className="flex-[55] h-64 rounded-xl" />
          <Skeleton className="flex-[45] h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  if (offer.error || !offer.data) {
    return (
      <div className="text-center py-16">
        <p className="text-[#8B8B8B] text-sm">Oferta no encontrada</p>
        <button onClick={onBack} className="mt-3 text-[13px] text-[#1F114C] hover:underline">
          {t.offers.backToList}
        </button>
      </div>
    );
  }

  const o = offer.data;
  const statusInfo = OFFER_STATUS_LABEL[o.status] ?? OFFER_STATUS_LABEL.draft;
  const validations = o.validations ?? [];
  const legalChecks = (o.legalChecks ?? []) as Array<{
    id: string;
    checkName: string;
    completed: boolean;
    completedAt: Date | string | null;
    completedByUser: { id: string; firstName: string; lastName: string } | null;
  }>;

  const completedValidations = validations.filter((v) => v.status === 'passed').length;
  const totalValidations = validations.length || 6;
  const progressPct = totalValidations > 0 ? (completedValidations / totalValidations) * 100 : 0;
  const allComplete = completedValidations === totalValidations && totalValidations > 0;

  const benefits = o.benefits as Record<string, string> | null;
  const benefitList = benefits ? Object.values(benefits) : [];
  const terms = o.terms as Record<string, string> | null;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-[13px] text-[#8B8B8B] hover:text-[#585858] transition"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        {t.offers.backToList}
      </button>

      {/* Candidate Header */}
      <CandidateHeader
        offer={o}
        statusLabel={statusInfo.label}
        completedValidations={completedValidations}
        totalValidations={totalValidations}
        progressPct={progressPct}
        allComplete={allComplete}
      />

      {/* Two columns */}
      <div className="flex gap-6">
        {/* LEFT: Offer details 55% */}
        <div className="flex-[55] space-y-4">
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
        <div className="flex-[45]">
          <OfferValidations
            offerId={offerId}
            validations={validations}
            legalChecks={legalChecks}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Candidate Header subcomponent ── */

interface CandidateHeaderProps {
  offer: {
    candidate: { firstName: string; lastName: string; avatar: string | null };
    vacancy: { title: string };
  };
  statusLabel: string;
  completedValidations: number;
  totalValidations: number;
  progressPct: number;
  allComplete: boolean;
}

function CandidateHeader({
  offer,
  statusLabel,
  completedValidations,
  totalValidations,
  progressPct,
  allComplete,
}: CandidateHeaderProps) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-5">
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-[#1F114C] to-[#5C4B99] flex items-center justify-center text-white text-xl font-bold shrink-0">
          {offer.candidate.firstName.charAt(0)}
          {offer.candidate.lastName.charAt(0)}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-[18px] font-bold text-[#1F114C]">
              {offer.candidate.firstName} {offer.candidate.lastName}
            </h1>
            <span className="bg-[#5C4B99] text-white text-[10px] font-medium px-2.5 py-0.5 rounded-full">
              {t.offers.preEmployment}
            </span>
          </div>
          <p className="text-[13px] text-[#585858]">{offer.vacancy.title}</p>
        </div>

        {/* Progress circle */}
        <div className="shrink-0 text-center">
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#EDEDED" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.9" fill="none"
                stroke="#22C55E" strokeWidth="2.5"
                strokeDasharray={`${progressPct} ${100 - progressPct}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[14px] font-bold text-[#1F114C]">
                {completedValidations}/{totalValidations}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-[#8B8B8B] mt-1">{t.offers.checksCompleted}</p>
        </div>

        {/* Authorize button */}
        <button
          className={`px-5 py-2.5 rounded-lg text-[13px] font-medium shrink-0 flex items-center gap-1.5 ${
            allComplete
              ? 'bg-[#DD0C15] text-white hover:bg-red-700 transition'
              : 'bg-[#EDEDED] text-[#8B8B8B] cursor-not-allowed'
          }`}
          disabled={!allComplete}
          onClick={() => toast('Autorizar contratacion: proximamente', { type: 'info' })}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          {t.offers.authorizeHiring}
        </button>
      </div>
    </div>
  );
}

/* ── Offer Card subcomponent ── */

interface OfferCardProps {
  offer: {
    salary: number;
    currency: string;
    startDate: Date | string | null;
    contractType: string | null;
    vacancy: { title: string };
    status: string;
  };
  statusInfo: { bg: string; text: string; label: string };
  benefitList: string[];
  terms: Record<string, string> | null;
}

function OfferCard({ offer, statusInfo, benefitList, terms }: OfferCardProps) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="bg-gradient-to-r from-[#1F114C] to-[#2D1B6E] px-5 py-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-white/60 text-[11px] font-medium tracking-wider uppercase">
              {t.offers.offerCard}
            </p>
            <p className="text-white text-[16px] font-semibold mt-0.5">{offer.vacancy.title}</p>
          </div>
          <span
            className={`${statusInfo.bg} ${statusInfo.text} text-[11px] font-medium px-3 py-1 rounded-full border border-white/20`}
          >
            {statusInfo.label}
          </span>
        </div>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-4">
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.baseSalary}</p>
            <p className="text-[15px] font-bold text-[#1F114C]">
              {formatCurrency(offer.salary, offer.currency)} / {t.vacancies.yearly.toLowerCase()}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.annualBonus}</p>
            <p className="text-[15px] font-bold text-[#1F114C]">{terms?.bonus || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.startDate}</p>
            <p className="text-[13px] text-[#333] font-medium">
              {offer.startDate ? formatDate(offer.startDate) : '—'}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.contractType}</p>
            <p className="text-[13px] text-[#333] font-medium">{offer.contractType || '—'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.schedule}</p>
            <p className="text-[13px] text-[#333]">{terms?.schedule || 'Full-time'}</p>
          </div>
          <div>
            <p className="text-[11px] text-[#8B8B8B]">{t.offers.modality}</p>
            <p className="text-[13px] text-[#333]">{terms?.modality || '—'}</p>
          </div>
        </div>
        {benefitList.length > 0 && (
          <div className="border-t border-[#F0F0F0] pt-3">
            <p className="text-[11px] text-[#8B8B8B] mb-2">{t.offers.benefitsIncluded}</p>
            <div className="flex flex-wrap gap-1.5">
              {benefitList.map((b, i) => (
                <span key={i} className="text-[10px] bg-[#F6F6F6] text-[#585858] px-2 py-1 rounded-full">
                  {String(b)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
