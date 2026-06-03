'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';

const fmtCurrency = (n: number, c: string) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: c }).format(n);
const fmtDate = (d: Date | string) => new Intl.DateTimeFormat('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(d));

export default function OfferSignPage() {
  const params = useParams();
  const token = params.token as string;

  const [accepted, setAccepted] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [signatureName, setSignatureName] = useState('');

  const offer = trpc.offer.getBySigningToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const acceptMutation = trpc.offer.acceptByToken.useMutation({
    onSuccess: () => setAccepted(true),
  });

  const declineMutation = trpc.offer.declineByToken.useMutation({
    onSuccess: () => setDeclined(true),
  });

  if (offer.isLoading) {
    return <StatusScreen bg="bg-[#1F114C]/10" color="text-[#1F114C]" icon="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" title="Cargando oferta..." subtitle="Un momento por favor." pulse />;
  }

  if (offer.error || !offer.data) {
    return <StatusScreen bg="bg-red-100" color="text-[#DD0C15]" icon="M15 9l-6 6M9 9l6 6" circle title="Enlace invalido" subtitle="Este enlace de firma no es valido o ha expirado. Contacta a recursos humanos." />;
  }

  const o = offer.data;

  if (o.status !== 'sent' && !accepted && !declined) {
    return <StatusScreen bg="bg-amber-100" color="text-amber-600" icon="M12 6v6l4 2" circle title="Esta oferta ya fue respondida" subtitle={`Esta oferta ya ha sido ${o.status === 'accepted' ? 'aceptada' : 'procesada'}. No se requiere accion adicional.`} />;
  }

  if (accepted) {
    return <StatusScreen bg="bg-green-100" color="text-green-600" icon="M22 11.08V12a10 10 0 11-5.93-9.14" title="Oferta aceptada exitosamente" subtitle={`Felicidades, ${o.candidate.firstName}. Tu aceptacion ha sido registrada. El equipo de recursos humanos se pondra en contacto contigo.`} />;
  }

  if (declined) {
    return <StatusScreen bg="bg-gray-100" color="text-gray-500" icon="M6 18L18 6M6 6l12 12" title="Oferta declinada" subtitle="Tu respuesta ha sido registrada. Gracias por tu tiempo." />;
  }

  const benefits = o.benefits as Record<string, string> | null;
  const benefitList = benefits ? Object.values(benefits) : [];
  const today = fmtDate(new Date());

  return (
    <div className="min-h-screen bg-[#FAFAFA] py-8 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header with org branding */}
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          {/* Top bar */}
          <div className="bg-[#1F114C] px-8 py-5 flex items-center gap-4">
            {o.organization.logo ? (
              <img src={o.organization.logo} alt="" className="h-10 w-10 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center">
                <span className="text-white font-bold text-lg">{o.organization.name.charAt(0)}</span>
              </div>
            )}
            <div>
              <h2 className="text-white font-semibold text-lg">{o.organization.name}</h2>
              <p className="text-white/70 text-xs">Carta de Oferta Laboral</p>
            </div>
          </div>

          {/* Content */}
          <div className="px-8 py-7 space-y-6">
            {/* Greeting */}
            <div>
              <p className="text-[#333] text-[15px] leading-relaxed">
                Estimado/a <strong>{o.candidate.firstName} {o.candidate.lastName}</strong>,
              </p>
              <p className="text-[#585858] text-[14px] leading-relaxed mt-3">
                Nos complace extenderle una oferta formal para el puesto de{' '}
                <strong className="text-[#1F114C]">{o.vacancy.title}</strong> en{' '}
                {o.organization.name}. A continuacion encontrara los detalles de su oferta.
              </p>
            </div>

            {/* Offer details grid */}
            <div className="bg-[#F8F7FC] rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#1F114C] mb-3">Detalles de la Oferta</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-sm">
                  <span className="text-[#8B8B8B] block text-xs">Cargo</span>
                  <span className="font-medium text-[#333]">{o.vacancy.title}</span>
                </div>
                <div className="text-sm">
                  <span className="text-[#8B8B8B] block text-xs">Salario</span>
                  <span className="font-medium text-[#333]">{fmtCurrency(o.salary, o.currency)}</span>
                </div>
                <div className="text-sm">
                  <span className="text-[#8B8B8B] block text-xs">Tipo de Contrato</span>
                  <span className="font-medium text-[#333]">{o.contractType}</span>
                </div>
                <div className="text-sm">
                  <span className="text-[#8B8B8B] block text-xs">Fecha de Inicio</span>
                  <span className="font-medium text-[#333]">{fmtDate(o.startDate)}</span>
                </div>
              </div>
            </div>

            {/* Benefits */}
            {benefitList.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#1F114C] mb-2">Beneficios</h3>
                <ul className="space-y-1.5">
                  {benefitList.map((b, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-[#585858]">
                      <svg className="w-4 h-4 text-green-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                      {b}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Divider */}
            <hr className="border-[#EDEDED]" />

            {/* Acceptance form */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-[#1F114C]">Aceptacion de la Oferta</h3>

              {/* Terms checkbox */}
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={agreedTerms}
                  onChange={(e) => setAgreedTerms(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-[#D1D5DB] text-[#1F114C] focus:ring-[#1F114C]"
                />
                <span className="text-[13px] text-[#585858] leading-snug">
                  He leido y acepto los terminos de esta oferta laboral. Entiendo que esta aceptacion
                  constituye mi firma digital y compromiso.
                </span>
              </label>

              {/* Signature name */}
              <div>
                <label className="block text-xs text-[#8B8B8B] mb-1.5">
                  Nombre completo (firma digital)
                </label>
                <input
                  type="text"
                  value={signatureName}
                  onChange={(e) => setSignatureName(e.target.value)}
                  placeholder="Ingresa tu nombre completo"
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm text-[#333] placeholder:text-[#C4C4C4] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
                />
              </div>

              {/* Date (readonly) */}
              <div>
                <label className="block text-xs text-[#8B8B8B] mb-1.5">Fecha</label>
                <input
                  type="text"
                  value={today}
                  readOnly
                  className="w-full h-10 px-3 rounded-lg border border-[#E5E5E5] text-sm text-[#585858] bg-[#FAFAFA]"
                />
              </div>

              {/* Error */}
              {acceptMutation.error && (
                <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">
                  {acceptMutation.error.message}
                </div>
              )}
              {declineMutation.error && (
                <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg">
                  {declineMutation.error.message}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => acceptMutation.mutate({ token, signatureName })}
                  disabled={!agreedTerms || signatureName.length < 2 || acceptMutation.isPending}
                  className="flex-1 h-11 rounded-xl bg-[#16A34A] text-white text-sm font-semibold hover:bg-[#15803D] transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {acceptMutation.isPending ? 'Procesando...' : 'Aceptar Oferta'}
                </button>
              </div>

              <button
                onClick={() => {
                  if (confirm('Estas seguro de que deseas declinar esta oferta?')) {
                    declineMutation.mutate({ token });
                  }
                }}
                disabled={declineMutation.isPending}
                className="w-full text-center text-xs text-[#8B8B8B] hover:text-[#DD0C15] transition py-2"
              >
                Declinar Oferta
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="bg-[#FAFAFA] px-8 py-4 border-t border-[#EDEDED]">
            <p className="text-[10px] text-[#8B8B8B] text-center">
              Este documento es confidencial. Al firmar digitalmente, aceptas los terminos de la oferta laboral.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusScreen({ bg, color, icon, circle, title, subtitle, pulse }: {
  bg: string; color: string; icon: string; title: string; subtitle: string; circle?: boolean; pulse?: boolean;
}) {
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-lg w-full text-center">
        <div className={`w-14 h-14 rounded-full ${bg} flex items-center justify-center mx-auto mb-4 ${pulse ? 'animate-pulse' : ''}`}>
          <svg className={`w-7 h-7 ${color}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            {circle && <circle cx="12" cy="12" r="10" />}
            <path d={icon} />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[#333] mb-2">{title}</h1>
        <p className="text-sm text-[#8B8B8B]">{subtitle}</p>
      </div>
    </div>
  );
}
