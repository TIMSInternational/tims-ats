'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

const GENDER_BAR: Record<string, string> = {
  male: 'bg-blue-500', female: 'bg-pink-400', non_binary: 'bg-purple-400', undisclosed: 'bg-gray-300',
};

function genderLabel(t: ReturnType<typeof useI18n>['t'], g: string): string {
  return g === 'male' ? t.dei.genderMale
    : g === 'female' ? t.dei.genderFemale
    : g === 'non_binary' ? t.dei.genderNonBinary
    : g === 'undisclosed' ? t.dei.genderUndisclosed
    : g;
}

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
  const { t } = useI18n();
  const q = trpc.dei.getGenderRepresentation.useQuery();

  return (
    <Card title={t.dei.genderRepresentation}>
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.dei.errGenderRep}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.dei.noDemographics}</p>
      ) : (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {q.data.map((g) => (
              <div key={g.gender} className={`${GENDER_BAR[g.gender] ?? 'bg-gray-300'} flex items-center justify-center`} style={{ width: `${g.percentage}%` }}>
                {g.percentage >= 8 && <span className="text-[9px] text-white font-medium">{g.percentage}%</span>}
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            {q.data.map((g) => (
              <div key={g.gender} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${GENDER_BAR[g.gender] ?? 'bg-gray-300'}`} />
                  <span className="text-[11px] text-[#333]">{genderLabel(t, g.gender)}</span>
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
  const { t } = useI18n();
  const q = trpc.dei.getPayEquity.useQuery();
  const gap = q.data?.gapPct;

  return (
    <Card title={t.dei.payEquityByGender}>
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.dei.errPayEquity}</p>
      ) : !q.data || q.data.results.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.dei.noComp}</p>
      ) : (
        <>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                <th className="text-left py-2 font-medium">{t.dei.colGender}</th>
                <th className="text-right py-2 font-medium">{t.dei.colEmployees}</th>
                <th className="text-right py-2 font-medium">{t.dei.colAverage}</th>
                <th className="text-right py-2 font-medium">{t.dei.colMedian}</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {q.data.results.map((row, i) => (
                <tr key={row.group} className={i < q.data!.results.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                  <td className="py-2 font-medium">{genderLabel(t, row.group)}</td>
                  <td className="text-right py-2">{row.count}</td>
                  <td className="text-right py-2">{fmtCOP(row.averageSalary)}</td>
                  <td className="text-right py-2">{fmtCOP(row.medianSalary)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {gap !== null && gap !== undefined && (
            <div className="mt-3 pt-2 border-t border-[#F0F0F0] flex items-center justify-between">
              <span className="text-[10px] text-[#8B8B8B]">{t.dei.medianGap}</span>
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
