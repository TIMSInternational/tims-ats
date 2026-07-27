'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { formatCurrency } from '../../../lib/format-utils';
import { useDeiPayEquity } from '../../../lib/platform-api/dei';

const fmtCompactCurrency = (n: number, currency: string) => formatCurrency(Math.round(n / 1000) * 1000, currency);

function genderLabel(t: ReturnType<typeof useI18n>['t'], g: string): string {
  return g === 'male'
    ? t.dei.genderMale
    : g === 'female'
      ? t.dei.genderFemale
      : g === 'non_binary'
        ? t.dei.genderNonBinary
        : g === 'undisclosed'
          ? t.dei.genderUndisclosed
          : g;
}

export function SalaryBands() {
  const { t } = useI18n();
  const q = trpc.compensation.getBandDistribution.useQuery();

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] font-semibold text-[#333]">{t.compensation.bands}</div>
        <span className="text-[10px] text-[#8B8B8B]">{t.compensation.bandsUnit}</span>
      </div>
      {q.isLoading ? (
        <div className="h-40 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.compensation.bandsErr}</p>
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.compensation.bandsEmpty}</p>
      ) : (
        <>
          <div className="space-y-3">
            {q.data.map((b) => (
              <div key={b.level + b.title} className="flex items-center gap-3">
                <div className="w-[72px] text-[11px] font-medium text-[#585858] shrink-0 truncate">{b.level}</div>
                <div className="flex-1 relative h-6">
                  <div className="absolute inset-y-0 rounded bg-[#1F114C]/10" style={{ left: '0%', right: '0%' }} />
                  <div
                    className="absolute top-1 bottom-1 rounded bg-[#1F114C]/30"
                    style={{ left: '25%', right: '25%' }}
                  />
                  {b.dots.map((d, i) => (
                    <div
                      key={i}
                      className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow ${d.outlier ? 'bg-[#DD0C15]' : 'bg-[#1F114C]'}`}
                      style={{ left: `${d.pos}%` }}
                    />
                  ))}
                </div>
                <div className="flex gap-2 text-[9px] text-[#8B8B8B] shrink-0 w-[130px] justify-end">
                  <span>{fmtCompactCurrency(b.min, b.currency ?? 'USD')}</span>
                  <span>{fmtCompactCurrency(b.mid, b.currency ?? 'USD')}</span>
                  <span>{fmtCompactCurrency(b.max, b.currency ?? 'USD')}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 pt-3 border-t border-[#EDEDED]">
            <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
              <div className="w-2 h-2 rounded-full bg-[#1F114C]" /> {t.compensation.legendInBand}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
              <div className="w-2 h-2 rounded-full bg-[#DD0C15]" /> {t.compensation.legendOutBand}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
              <div className="w-3 h-2 rounded bg-[#1F114C]/10" /> {t.compensation.legendRange}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function PayEquityCard() {
  const { t } = useI18n();
  const q = useDeiPayEquity();
  const gap = q.data?.gapPct;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="text-[13px] font-semibold text-[#333] mb-3">{t.dei.payEquityByGender}</div>
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
              <tr className="border-b border-[#EDEDED] text-[#8B8B8B]">
                <th className="text-left font-medium pb-2 pr-3">{t.dei.colGender}</th>
                <th className="text-right font-medium pb-2 px-2">{t.dei.colEmployees}</th>
                <th className="text-right font-medium pb-2 px-2">{t.dei.colAverage}</th>
                <th className="text-right font-medium pb-2 px-2">{t.dei.colMedian}</th>
              </tr>
            </thead>
            <tbody className="text-[#333]">
              {q.data.results.map((row, i) => (
                <tr key={row.group} className={i < q.data!.results.length - 1 ? 'border-b border-[#EDEDED]/60' : ''}>
                  <td className="py-2 pr-3 font-medium">{genderLabel(t, row.group)}</td>
                  {/* min-5 suppressed groups mask count + salary stats (a small group's average IS individual pay). */}
                  <td className="py-2 px-2 text-right">{row.suppressed ? t.dei.na : row.count}</td>
                  <td className="py-2 px-2 text-right">
                    {row.suppressed || row.averageSalary === null
                      ? t.dei.na
                      : formatCurrency(row.averageSalary, q.data?.currency ?? 'USD')}
                  </td>
                  <td className="py-2 px-2 text-right">
                    {row.suppressed || row.medianSalary === null
                      ? t.dei.na
                      : formatCurrency(row.medianSalary, q.data?.currency ?? 'USD')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {gap !== null && gap !== undefined && (
            <div className="mt-3 pt-2 border-t border-[#EDEDED] flex items-center justify-between">
              <span className="text-[10px] text-[#8B8B8B]">{t.dei.medianGap}</span>
              <span
                className={`text-[12px] font-semibold ${Math.abs(gap) < 3 ? 'text-green-600' : Math.abs(gap) <= 5 ? 'text-amber-500' : 'text-[#DD0C15]'}`}
              >
                {gap > 0 ? '+' : ''}
                {gap}%
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
