'use client';

import { useI18n } from '../../../../lib/i18n';

interface FeedbackItem {
  id: string;
  fromInitials: string;
  fromBg: string;
  fromText: string;
  fromName: string;
  toName: string;
  type: 'constructive' | 'improvement' | 'positive';
  message: string;
  timeAgo: string;
}

interface RecognitionItem {
  id: string;
  emoji: string;
  emojiBg: string;
  name: string;
  badge: string;
  badgeCls: string;
  message: string;
  by: string;
  when: string;
}

const FEEDBACK_TYPE: Record<string, { cls: string; labelKey: 'typeConstructive' | 'typeImprovement' | 'typePositive' }> = {
  constructive: { cls: 'bg-blue-50 text-blue-600', labelKey: 'typeConstructive' },
  improvement: { cls: 'bg-amber-50 text-amber-600', labelKey: 'typeImprovement' },
  positive: { cls: 'bg-green-50 text-green-600', labelKey: 'typePositive' },
};

const MOCK_FEEDBACK: FeedbackItem[] = [
  {
    id: '1', fromInitials: 'AG', fromBg: 'bg-emerald-100', fromText: 'text-emerald-700',
    fromName: 'Andrea Gutierrez', toName: 'Ricardo Mendoza', type: 'constructive',
    message: '"La presentacion del cliente Avianca estuvo muy bien preparada. Sugerencia: incluir metricas de ROI..."',
    timeAgo: 'Hace 2 horas',
  },
  {
    id: '2', fromInitials: 'CR', fromBg: 'bg-blue-100', fromText: 'text-blue-700',
    fromName: 'Carlos Ramirez', toName: 'Jorge Torres', type: 'improvement',
    message: '"Necesitamos priorizar el modulo de tracking. El atraso esta afectando al equipo completo..."',
    timeAgo: 'Hace 1 dia',
  },
  {
    id: '3', fromInitials: 'LP', fromBg: 'bg-orange-100', fromText: 'text-orange-700',
    fromName: 'Laura Paredes', toName: 'Sofia Castillo', type: 'positive',
    message: '"Excelente trabajo capacitando a los 12 operarios nuevos. Todos aprobaron la evaluacion al primer intento."',
    timeAgo: 'Hace 2 dias',
  },
];

const MOCK_RECOGNITION: RecognitionItem[] = [
  {
    id: '1', emoji: '\u2B50', emojiBg: 'bg-yellow-50',
    name: 'Sofia Castillo', badge: 'badgeExcellence', badgeCls: 'bg-yellow-50 text-yellow-700',
    message: '"100% de capacitacion completada antes de fecha. Compromiso excepcional con el equipo."',
    by: 'Por Ana Morales', when: 'Hoy',
  },
  {
    id: '2', emoji: '\uD83D\uDCAA', emojiBg: 'bg-blue-50',
    name: 'Andrea Gutierrez', badge: 'badgeTopPerformer', badgeCls: 'bg-blue-50 text-blue-700',
    message: '"14 de 15 cuentas cerradas. La mejor vendedora del trimestre sin duda."',
    by: 'Por Roberto Diaz', when: 'Hace 1 dia',
  },
  {
    id: '3', emoji: '\uD83E\uDD1D', emojiBg: 'bg-green-50',
    name: 'Carlos Ramirez', badge: 'badgeTeamwork', badgeCls: 'bg-green-50 text-green-700',
    message: '"Liderazgo ejemplar reduciendo tiempos de entrega. Apoyo constante a su equipo."',
    by: 'Por Roberto Diaz', when: 'Hace 3 dias',
  },
];

export function FeedbackPanel() {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Continuous Feedback */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.feedbackTitle}</h3>
          <button className="text-[10px] text-[#DD0C15] font-medium hover:underline">
            {t.performance.giveFeedback}
          </button>
        </div>
        <div className="divide-y divide-[#EDEDED]">
          {MOCK_FEEDBACK.map((fb) => {
            const typeBadge = FEEDBACK_TYPE[fb.type];
            return (
              <div key={fb.id} className="px-5 py-3 flex items-start gap-3">
                <div className={`w-7 h-7 rounded-full ${fb.fromBg} ${fb.fromText} flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5`}>
                  {fb.fromInitials}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-medium text-[#333]">{fb.fromName}</span>
                    <ArrowIcon />
                    <span className="text-[11px] text-[#585858]">{fb.toName}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge.cls}`}>
                      {t.performance[typeBadge.labelKey]}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#585858] line-clamp-1">{fb.message}</p>
                  <span className="text-[10px] text-[#8B8B8B]">{fb.timeAgo}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recognition Wall */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.recognitionTitle}</h3>
          <button className="text-[10px] text-[#DD0C15] font-medium hover:underline">
            {t.performance.recognize}
          </button>
        </div>
        <div className="divide-y divide-[#EDEDED]">
          {MOCK_RECOGNITION.map((r) => (
            <div key={r.id} className="px-5 py-3 flex items-start gap-3">
              <div className={`w-8 h-8 rounded-lg ${r.emojiBg} flex items-center justify-center text-[16px] shrink-0`}>
                {r.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-medium text-[#333]">{r.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.badgeCls}`}>
                    {t.performance[r.badge as keyof typeof t.performance]}
                  </span>
                </div>
                <p className="text-[11px] text-[#585858]">{r.message}</p>
                <span className="text-[10px] text-[#8B8B8B]">{r.by} &middot; {r.when}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg className="w-3 h-3 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}
