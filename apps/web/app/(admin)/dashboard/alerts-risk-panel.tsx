'use client';

import { useI18n } from '../../../lib/i18n';

interface RiskCandidate {
  initials: string;
  name: string;
  fitScore: number;
  fitColor: string;
  role: string;
  riskLabel: string;
  riskColor: string;
  aiAction: string;
}

// TODO: wire to API when endpoint is available
// Need: candidate.getRiskCandidates() — candidates with high fit scores who are
// stalled in pipeline, unresponsive, or have competing offers detected by AI.
const RISK_CANDIDATES: RiskCandidate[] = [
  {
    initials: 'ML',
    name: 'Maria Lopez',
    fitScore: 87,
    fitColor: 'bg-green-500',
    role: 'Senior SW Eng',
    riskLabel: 'Detenida 12 dias en Entrevista',
    riskColor: 'text-[#DD0C15]',
    aiAction: 'scheduleUrgent',
  },
  {
    initials: 'JP',
    name: 'Juan Perez',
    fitScore: 82,
    fitColor: 'bg-green-500',
    role: 'Product Mgr',
    riskLabel: 'Sin respuesta hace 8 dias',
    riskColor: 'text-amber-500',
    aiAction: 'contactWhatsapp',
  },
  {
    initials: 'AT',
    name: 'Ana Torres',
    fitScore: 78,
    fitColor: 'bg-amber-500',
    role: 'DevOps Eng',
    riskLabel: 'Oferta competidora detectada',
    riskColor: 'text-[#DD0C15]',
    aiAction: 'reviewCompensation',
  },
  {
    initials: 'CR',
    name: 'Carlos Ruiz',
    fitScore: 71,
    fitColor: 'bg-amber-500',
    role: 'UX Designer',
    riskLabel: 'Evaluacion vencida',
    riskColor: 'text-[#DD0C15]',
    aiAction: 'requestExtension',
  },
];

export function AlertsRiskPanel() {
  const { t } = useI18n();
  const rd = t.recruitingDashboard;

  return (
    <div className="flex-1 bg-white rounded-xl p-4 shadow-[0_2px_12px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[#1F114C]">{rd.riskCandidates}</span>
          <div className="w-2 h-2 rounded-full bg-[#DD0C15] animate-pulse" />
        </div>
        <span className="text-xs text-[#DD0C15]">
          {RISK_CANDIDATES.length} {rd.alerts}
        </span>
      </div>
      <div className="space-y-4">
        {RISK_CANDIDATES.map((c) => (
          <div key={c.initials}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-xs font-bold shrink-0">
                {c.initials}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-[#333]">{c.name}</span>
                  <span className={`${c.fitColor} text-white text-[10px] font-bold px-2 py-0.5 rounded-full`}>
                    FIT: {c.fitScore}
                  </span>
                </div>
                <p className="text-[11px] text-[#8B8B8B]">{c.role}</p>
                <p className={`text-[11px] ${c.riskColor}`}>{c.riskLabel}</p>
              </div>
            </div>
            <p className="text-[11px] text-teal-600 mt-1 ml-11 italic">
              {rd.aiSuggestion}: {rd[c.aiAction as keyof typeof rd] ?? c.aiAction}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
