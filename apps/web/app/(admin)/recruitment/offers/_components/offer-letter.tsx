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
  companyName?: string;
  hrDirector?: string;
}

export function OfferLetter({
  offer,
  companyName = 'TIMS International',
  hrDirector = 'Director de Recursos Humanos',
}: OfferLetterProps) {
  const { t } = useI18n();
  const benefits = offer.benefits ? Object.values(offer.benefits) : [];
  const terms = offer.terms as Record<string, string> | null;
  const candidateName = `${offer.candidate.firstName} ${offer.candidate.lastName}`;
  const today = formatDate(offer.createdAt);

  return (
    <div className="offer-letter bg-white text-[#1a1a1a] font-serif leading-relaxed max-w-[210mm] mx-auto px-16 py-12 print:px-12 print:py-8">
      {/* Company Header */}
      <header className="border-b-2 border-[#1F114C] pb-6 mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold text-[#1F114C] tracking-wide font-sans">
              {companyName}
            </h1>
            <p className="text-[11px] text-[#585858] mt-1 font-sans">
              Soluciones Empresariales en Talento Humano
            </p>
          </div>
          <div className="text-right text-[11px] text-[#8B8B8B] font-sans leading-snug">
            <p>{t.offers.cityCountry}</p>
            <p>info@timsinternational.com</p>
            <p>www.timsinternational.com</p>
          </div>
        </div>
      </header>

      {/* Date */}
      <p className="text-[13px] text-[#585858] mb-8 font-sans">{today}</p>

      {/* Salutation */}
      <p className="text-[15px] mb-6">
        Estimado(a) <span className="font-semibold">{candidateName}</span>,
      </p>

      {/* Opening Paragraph */}
      <p className="text-[14px] mb-6 text-justify">
        Nos complace extenderle una oferta formal para el cargo de{' '}
        <span className="font-semibold">{offer.vacancy.title}</span> en {companyName}.
        Tras un riguroso proceso de seleccion, estamos convencidos de que su experiencia y
        competencias seran una excelente contribucion a nuestro equipo. A continuacion, le
        presentamos los detalles de esta oferta.
      </p>

      {/* Position Details */}
      <section className="mb-6">
        <h2 className="text-[14px] font-bold text-[#1F114C] uppercase tracking-wider mb-3 font-sans border-b border-[#EDEDED] pb-1">
          Detalles del Cargo
        </h2>
        <table className="text-[13px] w-full">
          <tbody>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] w-40 font-sans">Cargo</td>
              <td className="py-2 font-medium">{offer.vacancy.title}</td>
            </tr>
            {offer.vacancy.department && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">Departamento</td>
                <td className="py-2">{offer.vacancy.department}</td>
              </tr>
            )}
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">{t.offers.startDateLabel}</td>
              <td className="py-2">{offer.startDate ? formatDate(offer.startDate) : 'Por confirmar'}</td>
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
          Compensacion
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
              <td className="py-2 text-[#8B8B8B] font-sans">Moneda</td>
              <td className="py-2">{offer.currency}</td>
            </tr>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">Periodicidad</td>
              <td className="py-2">{terms?.paymentPeriod || 'Mensual'}</td>
            </tr>
            {terms?.bonus && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">Bonificacion</td>
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
            Beneficios
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
          Condiciones
        </h2>
        <table className="text-[13px] w-full">
          <tbody>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] w-40 font-sans">{t.offers.contractTypeLabel}</td>
              <td className="py-2">{offer.contractType || 'Termino indefinido'}</td>
            </tr>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">Horario</td>
              <td className="py-2">{terms?.schedule || 'Tiempo completo'}</td>
            </tr>
            <tr className="border-b border-[#F6F6F6]">
              <td className="py-2 text-[#8B8B8B] font-sans">Modalidad</td>
              <td className="py-2">{terms?.modality || 'Presencial'}</td>
            </tr>
            {terms?.location && (
              <tr className="border-b border-[#F6F6F6]">
                <td className="py-2 text-[#8B8B8B] font-sans">Ubicacion</td>
                <td className="py-2">{terms.location}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Closing */}
      <p className="text-[14px] mb-4 text-justify">
        Le solicitamos confirmar su aceptacion de esta oferta dentro de los proximos cinco (5)
        dias habiles. Si tiene alguna pregunta o necesita aclaraciones adicionales, no dude en
        comunicarse con nuestro equipo de Recursos Humanos.
      </p>
      <p className="text-[14px] mb-10">
        Le damos una cordial bienvenida a {companyName}.
      </p>

      {/* HR Signature */}
      <div className="mb-12">
        <div className="w-48 border-b border-[#1a1a1a] mb-2" />
        <p className="text-[13px] font-semibold">{hrDirector}</p>
        <p className="text-[12px] text-[#8B8B8B]">{companyName}</p>
      </div>

      {/* Candidate Acceptance */}
      <section className="border-t-2 border-[#EDEDED] pt-6">
        <h2 className="text-[13px] font-bold text-[#1F114C] uppercase tracking-wider mb-4 font-sans">
          Aceptacion del Candidato
        </h2>
        <p className="text-[13px] mb-6">
          Yo, <span className="font-semibold">{candidateName}</span>, acepto los terminos y
          condiciones descritos en esta carta de oferta.
        </p>
        <div className="flex items-end gap-12">
          <div>
            <div className="w-52 border-b border-[#1a1a1a] mb-2" />
            <p className="text-[12px] text-[#8B8B8B]">{t.offers.candidateSignature}</p>
          </div>
          <div>
            <div className="w-36 border-b border-[#1a1a1a] mb-2" />
            <p className="text-[12px] text-[#8B8B8B]">Fecha</p>
          </div>
        </div>
      </section>
    </div>
  );
}
