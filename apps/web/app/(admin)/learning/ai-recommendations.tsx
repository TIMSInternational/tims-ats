'use client';

interface AiRecommendationsProps {
  t: {
    aiRecommendations: string;
    recommendedFor: string;
    gap: string;
    peopleAffected: string;
  };
}

const DEMO_RECS = [
  {
    title: 'Gestion de Conflictos Laborales',
    score: 94,
    target: 'Supervisores con brecha en comunicacion',
    gap: 'Comunicacion',
    gapColor: 'bg-purple-50 text-purple-600',
    affected: 12,
  },
  {
    title: 'Power BI para Operaciones',
    score: 89,
    target: 'Analistas y coordinadores logisticos',
    gap: 'Datos',
    gapColor: 'bg-blue-50 text-blue-600',
    affected: 8,
  },
  {
    title: 'Metodologias Agiles en Logistica',
    score: 76,
    target: 'Jefes de area con baja eficiencia',
    gap: 'Gestion',
    gapColor: 'bg-amber-50 text-amber-600',
    affected: 15,
  },
  {
    title: 'Ingles Tecnico Maritimo B2',
    score: 71,
    target: 'Operadores con contacto internacional',
    gap: 'Idiomas',
    gapColor: 'bg-indigo-50 text-indigo-600',
    affected: 21,
  },
];

export function AiRecommendations({ t }: AiRecommendationsProps) {
  return (
    <div className="w-[40%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
          </svg>
        </div>
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.aiRecommendations}</h3>
      </div>
      <div className="space-y-2.5">
        {DEMO_RECS.map((rec) => {
          const scoreColor = rec.score >= 85 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600';
          return (
            <div key={rec.title} className="border border-[#EDEDED] rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[11px] font-medium text-[#333]">{rec.title}</p>
                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${scoreColor}`}>{rec.score}%</span>
              </div>
              <p className="text-[10px] text-[#8B8B8B] mb-1.5">
                {t.recommendedFor}: {rec.target}
              </p>
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded ${rec.gapColor}`}>
                  {t.gap}: {rec.gap}
                </span>
                <span className="text-[9px] text-[#8B8B8B]">
                  {rec.affected} {t.peopleAffected}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
