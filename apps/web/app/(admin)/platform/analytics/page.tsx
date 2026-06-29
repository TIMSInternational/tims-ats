'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCard, KpiCardSkeleton } from '../../../../components';
import { formatCurrency } from '../../../../lib/format-utils';

const PLAN_COLORS: Record<string, string> = {
  trial: '#B5AAE0', starter: '#9B8DD4', professional: '#5B42A5', enterprise: '#2D1B69',
};

const MODULE_COLORS = ['#1F114C', '#2D1B69', '#3D2980', '#5B42A5', '#7B6BBF', '#9B8DD4', '#B5AAE0', '#D1CAF0', '#E8E4F5', '#F0EEF7'];

const FLAG_LABELS: Record<string, string> = {
  ai_enabled: 'AI', nine_box_enabled: 'Nine Box', dei_enabled: 'DEI',
  compensation_enabled: 'Compensacion', succession_enabled: 'Sucesion',
  video_interviews: 'Video Interviews', whatsapp_enabled: 'WhatsApp',
  advanced_analytics: 'Analytics', api_access: 'API Access', sso_saml: 'SSO/SAML',
};

export default function AnalyticsPage() {
  const { t } = useI18n();
  const { data, isLoading } = trpc.platform.getAnalytics.useQuery();

  if (isLoading) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">{Array.from({ length: 5 }).map((_, i) => <KpiCardSkeleton key={i} />)}</div>
        <div className="flex flex-col md:flex-row gap-5">
          <div className="w-full md:w-[55%] space-y-5"><div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[300px] animate-pulse" /><div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[280px] animate-pulse" /></div>
          <div className="w-full md:w-[45%] space-y-5"><div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[200px] animate-pulse" /><div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 h-[280px] animate-pulse" /></div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full overflow-y-auto p-6">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-12 text-center">
          <p className="text-sm text-[#8B8B8B]">{t.analytics.noData}</p>
        </div>
      </div>
    );
  }

  const totalSubs = data.subscriptionsByPlan ? Object.values(data.subscriptionsByPlan).reduce((s: number, v) => s + (v as number), 0) : 0;
  const orgDelta = data.newOrgsPrevMonth > 0 ? Math.round(((data.newOrgsThisMonth - data.newOrgsPrevMonth) / data.newOrgsPrevMonth) * 100) : data.newOrgsThisMonth > 0 ? 100 : 0;
  const userDelta = data.newUsersPrevMonth > 0 ? Math.round(((data.newUsersThisMonth - data.newUsersPrevMonth) / data.newUsersPrevMonth) * 100) : data.newUsersThisMonth > 0 ? 100 : 0;
  const aiTotal = data.aiUsage.totalCalls;
  const haikuPct = aiTotal > 0 ? Math.round((data.aiUsage.haikuCalls / aiTotal) * 100) : 0;
  const sonnetPct = 100 - haikuPct;

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <KpiCard
          label={t.analytics.newOrgs}
          value={`+${data.newOrgsThisMonth}`}
          subtitle={`${orgDelta >= 0 ? '+' : ''}${orgDelta}% ${t.analytics.vsPrevMonth}`}
          icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15" /></svg>}
          iconBg="bg-[#1F114C]/10"
        />
        <KpiCard
          label={t.analytics.newUsers}
          value={`+${data.newUsersThisMonth}`}
          subtitle={`${userDelta >= 0 ? '+' : ''}${userDelta}% ${t.analytics.vsPrevMonth}`}
          icon={<svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>}
          iconBg="bg-blue-50"
        />
        <KpiCard
          label={t.analytics.churnRate}
          value={`${data.churnRate}%`}
          subtitle={t.analytics.monthly}
          valueColor={data.churnRate > 3 ? 'text-[#DD0C15]' : undefined}
          icon={<svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898m0 0l3.182-5.511m-3.182 5.51l-5.511-3.181" /></svg>}
          iconBg="bg-amber-50"
        />
        <KpiCard
          label={t.analytics.arpu}
          value={`$${data.arpu}`}
          subtitle={t.analytics.usdOrgMonth}
          icon={<svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
          iconBg="bg-green-50"
        />
        <KpiCard
          label={t.analytics.dauMau}
          value={`${data.dauMauRatio}%`}
          subtitle={t.analytics.engagementRatio}
          icon={<svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>}
          iconBg="bg-violet-50"
        />
      </div>

      {/* Two-column layout */}
      <div className="flex flex-col md:flex-row gap-5">
        {/* LEFT 55% */}
        <div className="w-full md:w-[55%] space-y-5">
          {/* Growth Chart */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#333]">{t.analytics.growth}</h3>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]"><span className="w-2.5 h-2.5 rounded-full bg-[#1F114C]" />{t.analytics.organizations}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-[#8B8B8B]"><span className="w-2.5 h-2.5 rounded-full bg-[#DD0C15]" />{t.analytics.users}</span>
              </div>
            </div>
            {data.growth.length > 0 ? (() => {
              const maxVal = Math.max(...data.growth.map(g => Math.max(g.orgs, g.users)), 1);
              const BAR_H = 160;
              return (
                <div className="flex items-end gap-3 px-2" style={{ height: BAR_H + 30 }}>
                  {data.growth.map((g, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                      <div className="flex items-end gap-1 w-full" style={{ height: BAR_H }}>
                        <div className="flex-1 rounded-t-md bg-[#1F114C]/80 flex-shrink-0" style={{ height: Math.max(Math.round((g.orgs / maxVal) * BAR_H), 4) }} title={`Orgs: ${g.orgs}`} />
                        <div className="flex-1 rounded-t-md bg-[#DD0C15]/70 flex-shrink-0" style={{ height: Math.max(Math.round((g.users / maxVal) * BAR_H), 4) }} title={`Users: ${g.users}`} />
                      </div>
                      <span className="text-[10px] text-[#8B8B8B]">{g.month}</span>
                    </div>
                  ))}
                </div>
              );
            })() : <p className="text-sm text-[#8B8B8B] text-center py-8">{t.analytics.noData}</p>}
            <div className="mt-4 flex gap-6 text-xs text-[#8B8B8B]">
              <span>{t.analytics.organizations}: <strong className="text-[#333]">{data.totalOrgs}</strong></span>
              <span>{t.analytics.users}: <strong className="text-[#333]">{data.totalUsers.toLocaleString()}</strong></span>
            </div>
          </div>

          {/* Plan Distribution */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">{t.analytics.planDistribution}</h3>
            {totalSubs > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.subscriptionsByPlan).map(([plan, count]) => {
                  const pct = Math.round(((count as number) / totalSubs) * 100);
                  return (
                    <div key={plan} className="flex items-center gap-3">
                      <span className="text-xs text-[#585858] w-[100px] text-right capitalize">{plan}</span>
                      <div className="flex-1 bg-[#F6F6F6] rounded-full h-5 overflow-hidden">
                        <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all" style={{ width: `${Math.max(pct, 5)}%`, backgroundColor: PLAN_COLORS[plan] ?? '#7B6BBF' }}>
                          <span className="text-[10px] text-white font-medium">{pct}%</span>
                        </div>
                      </div>
                      <span className="text-xs text-[#8B8B8B] w-8 text-right">{count as number}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[#8B8B8B] text-center py-6">{t.analytics.noSubData}</p>}
            <div className="mt-3 text-[11px] text-[#8B8B8B]">{t.analytics.totalSubs}: {totalSubs}</div>
          </div>

          {/* Module Adoption */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">{t.analytics.moduleAdoption}</h3>
            {data.moduleAdoption.length > 0 ? (
              <div className="space-y-3">
                {data.moduleAdoption.map((mod, i) => (
                  <div key={mod.key} className="flex items-center gap-3">
                    <span className="text-xs text-[#585858] w-[100px] text-right">{FLAG_LABELS[mod.key] ?? mod.key}</span>
                    <div className="flex-1 bg-[#F6F6F6] rounded-full h-5 overflow-hidden">
                      <div className="h-full rounded-full flex items-center pr-2 transition-all" style={{ width: `${Math.max(mod.pct, 5)}%`, backgroundColor: MODULE_COLORS[i] ?? '#9B8DD4', justifyContent: mod.pct > 30 ? 'flex-end' : 'flex-start' }}>
                        <span className={`text-[10px] text-white font-medium ${mod.pct <= 30 ? 'ml-1' : ''}`}>{mod.pct}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-[#8B8B8B] text-center py-6">{t.analytics.noModuleData}</p>}
            <div className="mt-3 text-[11px] text-[#8B8B8B]">{t.analytics.pctOrgsUsingModule}</div>
          </div>
        </div>

        {/* RIGHT 45% */}
        <div className="w-full md:w-[45%] space-y-5">
          {/* AI Usage */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">{t.analytics.aiUsage}</h3>
            <div className="flex flex-col md:flex-row gap-5">
              <div className="flex-1 space-y-3">
                <div>
                  <div className="text-[11px] text-[#8B8B8B] uppercase">{t.analytics.totalCalls}</div>
                  <div className="text-xl font-bold text-[#333]">{aiTotal.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B8B8B] uppercase">{t.analytics.totalCost}</div>
                  <div className="text-xl font-bold text-[#333]">${data.aiUsage.totalCost.toFixed(2)}</div>
                </div>
                {data.aiUsage.topAgents.length > 0 && (
                  <div className="pt-2 border-t border-[#EDEDED]">
                    <div className="text-[11px] text-[#8B8B8B] uppercase mb-2">{t.analytics.topAgents}</div>
                    <div className="space-y-1.5">
                      {data.aiUsage.topAgents.slice(0, 3).map((a, i) => (
                        <div key={i} className="flex justify-between text-xs"><span className="text-[#585858]">{a.name}</span><span className="text-[#333] font-medium">{a.calls.toLocaleString()}</span></div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Donut */}
              <div className="flex flex-col items-center justify-center">
                <div className="relative w-[120px] h-[120px]">
                  <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#EDEDED" strokeWidth="12" />
                    {aiTotal > 0 && <>
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#1F114C" strokeWidth="12" strokeDasharray={`${haikuPct * 3.14} ${(100 - haikuPct) * 3.14}`} strokeLinecap="round" />
                      <circle cx="60" cy="60" r="50" fill="none" stroke="#DD0C15" strokeWidth="12" strokeDasharray={`${sonnetPct * 3.14} ${(100 - sonnetPct) * 3.14}`} strokeDashoffset={`${-(haikuPct * 3.14)}`} strokeLinecap="round" />
                    </>}
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-lg font-bold text-[#333]">{aiTotal >= 1000 ? `${(aiTotal / 1000).toFixed(1)}K` : aiTotal}</div>
                      <div className="text-[10px] text-[#8B8B8B]">{t.analytics.calls}</div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 mt-3">
                  <span className="flex items-center gap-1 text-[11px] text-[#8B8B8B]"><span className="w-2 h-2 rounded-full bg-[#1F114C]" />Haiku {haikuPct}%</span>
                  <span className="flex items-center gap-1 text-[11px] text-[#8B8B8B]"><span className="w-2 h-2 rounded-full bg-[#DD0C15]" />Sonnet {sonnetPct}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Geographic Distribution */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-4">{t.analytics.geoDistribution}</h3>
            {data.geo.length > 0 ? (
              <div className="space-y-2.5">
                {data.geo.map((c, i) => {
                  const maxCount = data.geo[0]?.count || 1;
                  const pct = Math.round((c.count / maxCount) * 100);
                  return (
                    <div key={c.country} className="flex items-center gap-3">
                      <span className="text-sm text-[#585858] flex-1">{c.country}</span>
                      <div className="w-[140px] bg-[#F6F6F6] rounded-full h-2 overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: MODULE_COLORS[i] ?? '#9B8DD4' }} />
                      </div>
                      <span className="text-sm font-semibold text-[#333] w-10 text-right">{c.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-sm text-[#8B8B8B] text-center py-6">{t.analytics.noGeoData}</p>}
            <div className="mt-3 pt-3 border-t border-[#EDEDED] flex justify-between text-xs text-[#8B8B8B]">
              <span>{t.analytics.totalUsers}</span>
              <span className="font-semibold text-[#333]">{data.totalUsers.toLocaleString()}</span>
            </div>
          </div>

          {/* Revenue */}
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <h3 className="text-sm font-semibold text-[#333] mb-3">{t.analytics.revenue}</h3>
            <div className="flex gap-6">
              <div className="flex-1">
                <div className="text-[11px] text-[#8B8B8B] uppercase">{t.analytics.estimatedMrr}</div>
                <div className="text-xl font-bold text-[#333]">{formatCurrency(data.mrr)}</div>
                <div className="text-xs text-[#8B8B8B] mt-1">ARPU x {t.analytics.organizations}</div>
              </div>
              <div className="w-px bg-[#EDEDED]" />
              <div className="flex-1">
                <div className="text-[11px] text-[#8B8B8B] uppercase">{t.analytics.arpuLabel}</div>
                <div className="text-xl font-bold text-[#333]">${data.arpu}</div>
                <div className="text-xs text-[#8B8B8B] mt-1">{t.analytics.usdOrgMonth}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
