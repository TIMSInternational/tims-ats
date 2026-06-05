'use client';

import { trpc } from '../../../../lib/trpc';

const GENDER_META: Record<string, { label: string; bar: string; dot: string }> = {
  male: { label: 'Hombres', bar: 'bg-blue-500', dot: 'bg-blue-500' },
  female: { label: 'Mujeres', bar: 'bg-pink-500', dot: 'bg-pink-500' },
  non_binary: { label: 'No-binario', bar: 'bg-purple-400', dot: 'bg-purple-400' },
  undisclosed: { label: 'No especificado', bar: 'bg-gray-300', dot: 'bg-gray-300' },
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function PromotionEquity() {
  const q = trpc.dei.getPromotionEquity.useQuery();

  return (
    <Card title="Promociones">
      {q.isLoading ? (
        <div className="h-16 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar las promociones.</p>
      ) : (
        <>
          <p className="text-[24px] font-bold text-[#1F114C]">{q.data?.totalPromotions ?? 0}</p>
          <p className="text-[10px] text-[#8B8B8B] mt-1">
            promociones en {q.data?.year}. El desglose por género se habilitará al vincular ajustes salariales con datos demográficos.
          </p>
        </>
      )}
    </Card>
  );
}

export function LeadershipDiversity() {
  const q = trpc.dei.getLeadershipDiversity.useQuery();

  return (
    <Card title="Diversidad en Liderazgo">
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar la diversidad en liderazgo.</p>
      ) : !q.data || q.data.totalLeaders === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin líderes con datos demográficos registrados.</p>
      ) : (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {q.data.byGender.map((g) => (
              <div key={g.gender} className={`${GENDER_META[g.gender]?.bar ?? 'bg-gray-300'}`} style={{ width: `${g.percentage}%` }} />
            ))}
          </div>
          <div className="space-y-1.5">
            {q.data.byGender.map((g) => (
              <div key={g.gender} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${GENDER_META[g.gender]?.dot ?? 'bg-gray-300'}`} />
                  <span className="text-[11px] text-[#333]">{GENDER_META[g.gender]?.label ?? g.gender}</span>
                </div>
                <span className="text-[11px] font-semibold text-[#1F114C]">{g.percentage}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#8B8B8B] mt-2 pt-2 border-t border-[#F0F0F0]">
            {q.data.totalLeaders} líderes · Meta 2026: <strong className="text-[#1F114C]">40% mujeres</strong>
          </p>
        </>
      )}
    </Card>
  );
}

export function InclusionTrend() {
  const q = trpc.dei.getInclusionIndex.useQuery();

  return (
    <Card title="Índice de Inclusión">
      {q.isLoading ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar el índice de inclusión.</p>
      ) : q.data?.index === null || q.data?.index === undefined ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin encuesta de clima con preguntas de inclusión aún.</p>
      ) : (
        <>
          <p className="text-[32px] font-bold text-green-600">{q.data.index}<span className="text-[14px] text-[#8B8B8B] font-normal"> / 100</span></p>
          <p className="text-[10px] text-[#8B8B8B] mt-1">
            Basado en {q.data.totalResponses} respuestas de la encuesta de clima. El histórico trimestral se mostrará al acumular encuestas.
          </p>
        </>
      )}
    </Card>
  );
}
