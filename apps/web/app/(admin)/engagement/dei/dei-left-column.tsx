'use client';

import { trpc } from '../../../../lib/trpc';

const GENDER_META: Record<string, { label: string; bar: string; dot: string }> = {
  male: { label: 'Hombres', bar: 'bg-blue-500', dot: 'bg-blue-500' },
  female: { label: 'Mujeres', bar: 'bg-pink-400', dot: 'bg-pink-400' },
  non_binary: { label: 'No-binario', bar: 'bg-purple-400', dot: 'bg-purple-400' },
  undisclosed: { label: 'No especificado', bar: 'bg-gray-300', dot: 'bg-gray-300' },
};

const fmtCOP = (n: number) => `$${Math.round(n / 1000).toLocaleString('es-CO')}K`;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function GenderByDepartment() {
  const q = trpc.dei.getGenderRepresentation.useQuery();

  return (
    <Card title="Representación de Género">
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar la representación de género.</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin datos demográficos registrados aún.</p>
      ) : (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {q.data.map((g) => (
              <div key={g.gender} className={`${GENDER_META[g.gender]?.bar ?? 'bg-gray-300'} flex items-center justify-center`} style={{ width: `${g.percentage}%` }}>
                {g.percentage >= 8 && <span className="text-[9px] text-white font-medium">{g.percentage}%</span>}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {q.data.map((g) => (
              <div key={g.gender} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${GENDER_META[g.gender]?.dot ?? 'bg-gray-300'}`} />
                  <span className="text-[11px] text-[#333]">{GENDER_META[g.gender]?.label ?? g.gender}</span>
                </div>
                <span className="text-[11px] text-[#8B8B8B]">{g.count} · {g.percentage}%</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

export function PayEquityTable() {
  const q = trpc.dei.getPayEquity.useQuery();
  const gap = q.data?.gapPct;

  return (
    <Card title="Equidad Salarial por Género">
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">No se pudo cargar la equidad salarial.</p>
      ) : !q.data || q.data.results.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">Sin datos de compensación con género registrado.</p>
      ) : (
        <>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                <th className="text-left py-2 font-medium">Género</th>
                <th className="text-right py-2 font-medium">Empleados</th>
                <th className="text-right py-2 font-medium">Promedio</th>
                <th className="text-right py-2 font-medium">Mediana</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {q.data.results.map((row, i) => (
                <tr key={row.group} className={i < q.data!.results.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                  <td className="py-2 font-medium">{GENDER_META[row.group]?.label ?? row.group}</td>
                  <td className="text-right py-2">{row.count}</td>
                  <td className="text-right py-2">{fmtCOP(row.averageSalary)}</td>
                  <td className="text-right py-2">{fmtCOP(row.medianSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {gap !== null && gap !== undefined && (
            <div className="mt-3 pt-2 border-t border-[#F0F0F0] flex items-center justify-between">
              <span className="text-[10px] text-[#8B8B8B]">Brecha mediana F vs M</span>
              <span className={`text-[12px] font-semibold ${Math.abs(gap) < 3 ? 'text-green-600' : Math.abs(gap) <= 5 ? 'text-amber-500' : 'text-[#DD0C15]'}`}>
                {gap > 0 ? '+' : ''}{gap}%
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
