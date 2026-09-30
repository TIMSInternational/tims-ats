'use client';

import { formatCurrency, formatDate } from '../../../../../lib/format-utils';
import { useI18n } from '../../../../../lib/i18n';

interface OfferLetterProps {
  offer: {
    candidate: { firstName: string; lastName: string };
    vacancy: { title: string; department?: string | null };
    salary: number;
    currency: string;
    startDate: Date | string | null;
    contractType: string | null;
    benefits: Record<string, string> | null;
    terms: Record<string, string> | null;
    createdAt: Date | string;
  };
  companyName: string;
}

export function OfferLetter({
  offer,
  companyName,
}: OfferLetterProps) {
  const { t } = useI18n();
  const benefits = offer.benefits ? Object.values(offer.benefits) : [];
  const terms = offer.terms as Record<string, string> | null;
  const candidateName = `${offer.candidate.firstName} ${offer.candidate.lastName}`;

  return (
    <div className="offer-letter bg-white text-[#1a1a1a] font-serif leading-relaxed max-w-[210mm] mx-auto px-16 py-12 print:px-12 print:py-8">
      {/* Company Header */}
      <header className="border-b-2 border-[#1F114C] pb-6 mb-8">
        <h1 className="text-[22px] font-bold text-[#1F114C] tracking-wide font-sans">
          {companyName}
        </h1>
      </header>

      {/* Salutation */}
      <p className="text-[15px] mb-6">
        {t.offers.letterGreeting} <span className="font-semibold">{candidateName}</span>,
      </p>

      {/* Opening Paragraph */}
      <p className="text-[14px] mb-6 text-justify">
        {t.offers.letterIntro}
      </p>

      {/* Position Details */}
      <section className="mb-6">
        <h2 className="text-[14px] font-bold text-[#1F114C] uppercase tracking-wider mb-3 font-sans border-b border-[#EDEDED] pb-1">
          {t.offers.letterPositionDetails}
        </h2>
        <table className="text-[13px] w-full">
          <tbody>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] w-40 font-sans">{t.offers.letterPosition}</td>
              <td className="py-2 font-medium">{offer.vacancy.title}</td>
            </tr>
            {offer.vacancy.department && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.letterDepartment}</td>
                <td className="py-2">{offer.vacancy.department}</td>
              </tr>
            )}
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.startDateLabel}</td>
              <td className="py-2">{offer.startDate ? formatDate(offer.startDate) : t.offers.letterToConfirm}</td>
            </tr>
            {terms?.reportingTo && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.reportingTo}</td>
                <td className="py-2">{terms.reportingTo}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Compensation */}
      <section className="mb-6">
        <h2 className="text-[14px] font-bold text-[#1F114C] uppercase tracking-wider mb-3 font-sans border-b border-[#EDEDED] pb-1">
          {t.offers.letterCompensation}
        </h2>
        <table className="text-[13px] w-full">
          <tbody>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] w-40 font-sans">{t.offers.annualBaseSalary}</td>
              <td className="py-2 font-semibold text-[#1F114C]">
                {formatCurrency(offer.salary, offer.currency)}
              </td>
            </tr>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.currency}</td>
              <td className="py-2">{offer.currency}</td>
            </tr>
            {terms?.paymentPeriod && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.letterPaymentFrequency}</td>
                <td className="py-2">{terms.paymentPeriod}</td>
              </tr>
            )}
            {terms?.bonus && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.annualBonus}</td>
                <td className="py-2">{terms.bonus}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="mb-6">
          <h2 className="text-[14px] font-bold text-[#1F114C] uppercase tracking-wider mb-3 font-sans border-b border-[#EDEDED] pb-1">
            {t.offers.benefitsIncluded}
          </h2>
          <ul className="text-[13px] space-y-1.5 list-disc list-inside pl-2">
            {benefits.map((b, i) => (
              <li key={i}>{String(b)}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Terms */}
      <section className="mb-6">
        <h2 className="text-[14px] font-bold text-[#1F114C] uppercase tracking-wider mb-3 font-sans border-b border-[#EDEDED] pb-1">
          {t.offers.letterConditions}
        </h2>
        <table className="text-[13px] w-full">
          <tbody>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] w-40 font-sans">{t.offers.contractTypeLabel}</td>
              <td className="py-2">{offer.contractType || t.offers.letterToConfirm}</td>
            </tr>
            {terms?.schedule && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.schedule}</td>
                <td className="py-2">{terms.schedule}</td>
              </tr>
            )}
            {terms?.modality && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.modality}</td>
                <td className="py-2">{terms.modality}</td>
              </tr>
            )}
            {terms?.location && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.letterLocation}</td>
                <td className="py-2">{terms.location}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <p className="text-[13px] text-[#585858] border-t border-[#EDEDED] pt-5">
        {t.offers.letterResponseNote}
      </p>
    </div>
  );
}
