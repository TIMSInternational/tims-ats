'use client';

import { trpc } from '../../../../lib/trpc';

const AGE_COLORS: Record<string, string> = {
  '<25': '#B8AED4', '25-34': '#7B6BAA', '35-44': '#5C4B99', '45-54': '#3D2D7A', '55+': '#1F114C',
};

const COUNTRY_NAMES: Record<string, string> = {
  CO: 'Colombia', VE: 'Venezuela', US: 'Estados Unidos', EC: 'Ecuador', PE: 'Perú',
  MX: 'México', CL: 'Chile', AR: 'Argentina', BR: 'Brasil',
};

const NAT_COLORS = ['#1F114C', '#5C4B99', '#7B6BAA', '#B8AED4', '#D4CFE5', '#E8E5F0'];

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function AgeDistribution() {
  const q = trpc.dei.getAgeDistribution.useQuery();
  const total = (q.data ?? []).reduce((sum, a) => sum + a.count, 0);

  return (
    <Card title="Distribución por Edad">
      {q.isLoading ? (
        <div className="h-28 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar la distribución por edad.</p>
      ) : total === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin fechas de nacimiento registradas aún.</p>
      ) : (
        <>
          <div className="space-y-2">
            {q.data!.map((a) => (
              <div key={a.range} className="flex items-center gap-2">
                <span className="text-[11px] text-[#585858] w-12 shrink-0">{a.range}</span>
                <div className="flex-1 bg-[#F6F6F6] rounded-full h-5 overflow-hidden">
                  <div className="h-5 rounded-full flex items-center px-2" style={{ width: `${Math.max(a.percentage, a.count > 0 ? 6 : 0)}%`, backgroundColor: AGE_COLORS[a.range] ?? '#5C4B99' }}>
                    {a.percentage >= 10 && <span className="text-[9px] text-white font-medium">{a.count}</span>}
                  </div>
                </div>
                <span className="text-[10px] text-[#8B8B8B] w-8">{a.percentage}%</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#8B8B8B] mt-2 text-center">
            Total: <strong className="text-[#1F114C]">{total}</strong> empleados con edad registrada
          </p>
        </>
      )}
    </Card>
  );
}

export function NationalityDiversity() {
  const q = trpc.dei.getNationalityDiversity.useQuery();

  return (
    <Card title="Diversidad por Nacionalidad">
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar la diversidad por nacionalidad.</p>
      ) : !q.data || q.data.distribution.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin nacionalidades registradas aún.</p>
      ) : (
        <div className="space-y-1.5">
          {q.data.distribution.map((n, i) => (
            <div key={n.nationality} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-[#585858] w-7">{n.nationality}</span>
                <span className="text-[11px] text-[#333]">{COUNTRY_NAMES[n.nationality] ?? n.nationality}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-24 bg-[#F6F6F6] rounded-full h-3 overflow-hidden">
                  <div className="h-3 rounded-full" style={{ width: `${n.percentage}%`, backgroundColor: NAT_COLORS[i % NAT_COLORS.length] }} />
                </div>
                <span className="text-[11px] font-medium text-[#1F114C] w-8 text-right">{n.percentage}%</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function HiringFunnel() {
  const q = trpc.dei.getHiringFunnel.useQuery();

  return (
    <Card title="Pipeline de Candidatos">
      {q.isLoading ? (
        <div className="h-16 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar el pipeline.</p>
      ) : (
        <>
          <p className="text-[24px] font-bold text-[#1F114C]">{q.data?.total ?? 0}</p>
          <p className="text-[10px] text-[#8B8B8B] mt-1">
            candidatos totales. El desglose de diversidad por etapa requiere datos demográficos de candidatos, que no se recopilan.
          </p>
        </>
      )}
    </Card>
  );
}
