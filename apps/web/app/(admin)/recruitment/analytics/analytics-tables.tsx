'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';

function CardSkeleton() {
  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse">
      <div className="h-40 bg-gray-100 rounded" />
    </div>
  );
}

function slaColors(sla: number | null) {
  if (sla == null) return { bar: 'bg-[#D4CFE5]', text: 'text-[#8B8B8B]' };
  if (sla >= 80) return { bar: 'bg-green-500', text: 'text-green-600' };
  if (sla >= 60) return { bar: 'bg-amber-500', text: 'text-amber-600' };
  return { bar: 'bg-[#DD0C15]', text: 'text-[#DD0C15]' };
}

export function AnalyticsSlaTable() {
  const { t } = useI18n();
  const q = trpc.recruitmentAnalytics.getRecruiterSla.useQuery();

  if (q.isLoading) return <CardSkeleton />;
  if (q.isError || !q.data) {
    return (
      <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center text-[12px] text-[#DD0C15]">
        {t.recruitAnalytics.errLoading}
      </div>
    );
  }

  const rows = q.data;

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.slaByRecruiter}</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B] text-center py-8">{t.recruitAnalytics.noAssignedVacancies}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[#EDEDED]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[11px]">
              <thead>
                <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
                  <th className="text-left py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.recruiter}</th>
                  <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.vacancies}</th>
                  <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.avgTtf}</th>
                  <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.candidates}</th>
                  <th className="text-center py-2.5 px-3 text-[#585858] font-medium">{t.recruitAnalytics.slaCompliance}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const colors = slaColors(row.slaCompliancePct);
                  return (
                    <tr
                      key={row.name}
                      className={`${idx < rows.length - 1 ? 'border-b border-[#F0F0F0]' : ''} ${idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''}`}
                    >
                      <td className="py-2.5 px-3 font-medium text-[#333]">{row.name}</td>
                      <td className="text-center py-2.5 px-3">{row.vacancies}</td>
                      <td className="text-center py-2.5 px-3">
                        {row.avgTtfDays != null ? `${row.avgTtfDays} ${t.recruitAnalytics.days}` : '—'}
                      </td>
                      <td className="text-center py-2.5 px-3">{row.candidates}</td>
                      <td className="text-center py-2.5 px-3">
                        {row.slaCompliancePct == null ? (
                          <span className="text-[#8B8B8B]">—</span>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <div className="w-16 bg-[#F6F6F6] rounded-full h-2">
                              <div className={`h-2 ${colors.bar} rounded-full`} style={{ width: `${row.slaCompliancePct}%` }} />
                            </div>
                            <span className={`${colors.text} font-medium`}>{row.slaCompliancePct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function AnalyticsQohBreakdown() {
  const { t } = useI18n();

  // Honest unavailable state — quality-of-hire needs performance/retention
  // data that doesn't exist yet (rule: no stub may impersonate a feature).
  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.recruitAnalytics.qohBreakdown}</h3>
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <svg className="w-8 h-8 text-[#D4CFE5] mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
        <p className="text-[12px] text-[#8B8B8B]">{t.recruitAnalytics.qohUnavailable}</p>
      </div>
    </div>
  );
}
