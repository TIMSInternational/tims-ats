'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { TrialsAlert } from './trials-alert';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const avatarColors = [
  'bg-[#1F114C]', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-600',
  'bg-indigo-500', 'bg-orange-500', 'bg-pink-500', 'bg-gray-400',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

function planBadge(plan: string) {
  const styles: Record<string, string> = { enterprise: 'bg-emerald-100 text-emerald-700', professional: 'bg-violet-100 text-violet-700', starter: 'bg-blue-100 text-blue-700', trial: 'bg-amber-100 text-amber-700' };
  const cls = styles[plan?.toLowerCase()] || 'bg-gray-100 text-gray-700';
  return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>{plan?.charAt(0).toUpperCase() + plan?.slice(1)}</span>;
}

function statusBadge(status: string, labels?: { active: string; trialing: string; pastDue: string; canceled: string }) {
  const l = labels || { active: 'Activa', trialing: 'En Prueba', pastDue: 'Pago Vencido', canceled: 'Cancelada' };
  const map: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-green-100 text-green-700', label: l.active },
    trialing: { cls: 'bg-blue-100 text-blue-700', label: l.trialing },
    past_due: { cls: 'bg-red-100 text-red-700', label: l.pastDue },
    cancelled: { cls: 'bg-gray-100 text-gray-600', label: l.canceled },
    canceled: { cls: 'bg-gray-100 text-gray-600', label: l.canceled },
  };
  const m = map[status?.toLowerCase()] || { cls: 'bg-gray-100 text-gray-600', label: status };
  return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${m.cls}`}>{m.label}</span>;
}

function Skeleton({ className }: { className: string }) { return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />; }

function SkeletonRow() {
  return (
    <tr className="border-b border-[#F6F6F6] animate-pulse">
      <td className="px-5 py-3"><div className="flex items-center gap-3"><div className="w-7 h-7 rounded-md bg-gray-200" /><div className="h-4 w-32 bg-gray-200 rounded" /></div></td>
      <td className="px-4 py-3"><div className="h-5 w-16 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3"><div className="h-5 w-14 bg-gray-100 rounded-full" /></td>
      <td className="px-4 py-3 text-right"><div className="h-4 w-14 bg-gray-100 rounded ml-auto" /></td>
      <td className="px-4 py-3"><div className="h-3 w-16 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-3 w-20 bg-gray-100 rounded" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 bg-gray-100 rounded mx-auto" /></td>
    </tr>
  );
}

export default function SubscriptionsPage() {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const limit = 10;

  const kpis = trpc.platform.getSubscriptionKpis.useQuery();
  const mrrTrend = trpc.platform.getMrrTrend.useQuery();
  const subs = trpc.platform.listSubscriptions.useQuery({ page, limit });
  const utils = trpc.useUtils();

  const updateSub = trpc.platform.updateSubscription.useMutation({
    onSuccess: () => {
      utils.platform.listSubscriptions.invalidate();
      utils.platform.getSubscriptionKpis.invalidate();
      toast('Suscripcion actualizada', { type: 'success' });
    },
    onError: (err) => { toast(err.message || 'Error al actualizar suscripcion', { type: 'error' }); },
  });

  const subscriptions = subs.data?.subscriptions ?? [];
  const total = subs.data?.total ?? 0;

  const handlePlanChange = (organizationId: string, currentPlan: string) => {
    const plans = ['starter', 'professional', 'enterprise'] as const;
    const currentIndex = plans.indexOf(currentPlan.toLowerCase() as typeof plans[number]);
    const nextPlan = plans[(currentIndex + 1) % plans.length];
    if (confirm(`Cambiar plan a ${nextPlan.charAt(0).toUpperCase() + nextPlan.slice(1)}?`)) {
      updateSub.mutate({ organizationId, plan: nextPlan });
    }
  };

  const handleCancel = (organizationId: string, orgName: string) => {
    if (confirm(`Cancelar suscripcion de ${orgName}?`)) {
      updateSub.mutate({ organizationId, status: 'cancelled' as const });
    }
  };

  const handleExtendTrial = (organizationId: string) => {
    const newEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    updateSub.mutate({ organizationId, trialEndsAt: newEnd });
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4 mb-5 flex-shrink-0">
        {kpis.isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 animate-pulse"><Skeleton className="h-3 w-24 mb-3" /><Skeleton className="h-7 w-16 mb-2" /><Skeleton className="h-3 w-20" /></div>
          ))
        ) : kpis.data ? (
          <>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">MRR</span><div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6" /></svg></div></div>
              <div className="text-2xl font-bold text-[#333]">{formatCurrency(kpis.data.mrr)}</div>
              <div className="flex items-center gap-1 mt-1"><svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7" /></svg><span className="text-xs text-green-500 font-medium">+12% vs mes anterior</span></div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
              <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{t.subscriptions.kpiActive}</span><div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg></div></div>
              <div className="text-2xl font-bold text-[#333]">{kpis.data.active}</div>
              <div className="text-xs text-[#8B8B8B] mt-1">{kpis.data.total > 0 ? Math.round((kpis.data.active / kpis.data.total) * 100) : 0}% del total de orgs</div>
            </div>
            <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 border border-amber-200">
              <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Trials por Vencer</span><div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg></div></div>
              <div className="text-2xl font-bold text-amber-600">{kpis.data.expiringTrials.length}</div>
              <div className="text-xs text-amber-500 mt-1 font-medium">Vencen en &lt;7 dias</div>
            </div>
            <div className={`bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 ${kpis.data.pastDue > 0 ? 'border border-red-200' : ''}`}>
              <div className="flex items-center justify-between mb-3"><span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">Pagos Fallidos</span><div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center"><svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg></div></div>
              <div className={`text-2xl font-bold ${kpis.data.pastDue > 0 ? 'text-[#DD0C15]' : 'text-[#333]'}`}>{kpis.data.pastDue}</div>
              <div className={`text-xs mt-1 font-medium ${kpis.data.pastDue > 0 ? 'text-[#DD0C15]' : 'text-[#8B8B8B]'}`}>{kpis.data.pastDue > 0 ? t.common.requiresAttention : t.common.noIssues}</div>
            </div>
          </>
        ) : null}
      </div>

      {/* MRR Trend Chart */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-5 flex-shrink-0">
        <div className="flex items-center justify-between mb-4"><h3 className="text-sm font-semibold text-[#333]">Tendencia de MRR</h3><span className="text-xs text-[#8B8B8B]">Ultimos 6 meses</span></div>
        {mrrTrend.isLoading ? (
          <div className="h-[130px] animate-pulse"><div className="h-full w-full bg-gray-100 rounded" /></div>
        ) : mrrTrend.data ? (
          <div className="flex items-end gap-4 h-[130px] px-2">
            {(() => {
              const max = Math.max(...mrrTrend.data.map((m) => m.mrr), 1);
              return mrrTrend.data.map((m, i) => {
                const heightPct = m.mrr > 0 ? Math.max(Math.round((m.mrr / max) * 92), 10) : 2;
                const isLast = i === mrrTrend.data!.length - 1;
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                    <span className={`text-[10px] font-medium ${isLast ? 'text-green-600 font-bold' : 'text-[#8B8B8B]'}`}>
                      {m.mrr === 0 ? '$0' : `$${m.mrr >= 1000 ? (m.mrr / 1000).toFixed(1) + 'K' : m.mrr}`}
                    </span>
                    <div className="w-full rounded-t-md" style={{ height: `${heightPct}%`, backgroundColor: m.mrr === 0 ? '#EDEDED' : isLast ? '#22c55e' : `rgba(34, 197, 94, ${0.2 + (i / 5) * 0.8})` }} />
                    <span className={`text-[10px] ${isLast ? 'text-[#333] font-medium' : 'text-[#8B8B8B]'}`}>{m.month.charAt(0).toUpperCase() + m.month.slice(1)}</span>
                  </div>
                );
              });
            })()}
          </div>
        ) : null}
      </div>

      {/* Subscription Table */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#EDEDED] flex-shrink-0">
          <h3 className="text-sm font-semibold text-[#333]">{t.subscriptions.title}</h3>
          <span className="text-xs text-[#8B8B8B]">{total} organizaciones</span>
        </div>
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full">
            <thead className="sticky top-0 bg-white z-10">
              <tr className="border-b border-[#EDEDED]">
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-5 py-3">Organizacion</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Plan</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Estado</th>
                <th className="text-right text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">MRR</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Periodo</th>
                <th className="text-left text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Trial Vence</th>
                <th className="text-center text-xs font-semibold text-[#8B8B8B] uppercase tracking-wide px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {subs.isLoading ? (<><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /></>) : subscriptions.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-16 text-center">
                  <svg className="w-12 h-12 text-[#EDEDED] mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2 12h5l3-9 4 18 3-9h5" /></svg>
                  <p className="text-sm text-[#8B8B8B]">No hay suscripciones registradas</p>
                </td></tr>
              ) : subscriptions.map((sub) => {
                const status = sub.status?.toLowerCase();
                const isCancelled = status === 'cancelled' || status === 'canceled';
                const isPastDue = status === 'past_due';
                const orgName = sub.organization?.name || 'Organizacion';
                const prices: Record<string, number> = { trial: 0, starter: 499, professional: 999, enterprise: 2499 };
                const mrr = prices[sub.plan] || 0;
                return (
                  <tr key={sub.id} className={`border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition ${isPastDue ? 'bg-red-50/30' : ''} ${isCancelled ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-7 h-7 rounded-md ${isCancelled ? 'bg-gray-400' : getAvatarColor(orgName)} flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0`}>{getInitials(orgName)}</div>
                        <span className="text-sm text-[#333] font-medium">{orgName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">{planBadge(sub.plan || 'trial')}</td>
                    <td className="px-4 py-3">{statusBadge(sub.status || 'active', { active: t.subscriptions.statusActive, trialing: t.subscriptions.statusTrialing, pastDue: t.subscriptions.statusPastDue, canceled: t.subscriptions.statusCanceled })}</td>
                    <td className="px-4 py-3 text-right"><span className={`text-sm font-semibold ${isPastDue ? 'text-[#DD0C15]' : isCancelled ? 'text-[#8B8B8B] line-through' : 'text-[#333]'}`}>{formatCurrency(mrr)}</span></td>
                    <td className="px-4 py-3"><span className="text-xs text-[#585858]">{status === 'trialing' ? '\u2014' : 'Mensual'}</span></td>
                    <td className="px-4 py-3"><span className={`text-xs ${sub.trialEndsAt ? 'text-amber-600 font-medium' : 'text-[#8B8B8B]'}`}>{sub.trialEndsAt ? formatDate(sub.trialEndsAt) : '\u2014'}</span></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5">
                        <button className="text-[10px] text-[#1F114C] font-medium hover:underline">Facturas</button>
                        <span className="text-[#EDEDED]">|</span>
                        {isCancelled ? <span className="text-[10px] text-[#8B8B8B]">{t.subscriptions.changePlan}</span> : (
                          <button onClick={() => handlePlanChange(sub.organizationId, sub.plan || 'starter')} disabled={updateSub.isPending} className="text-[10px] text-[#1F114C] font-medium hover:underline disabled:opacity-50">{t.subscriptions.changePlan}</button>
                        )}
                        <span className="text-[#EDEDED]">|</span>
                        {isCancelled ? <span className="text-[10px] text-[#8B8B8B]">{t.subscriptions.cancel}</span> : (
                          <button onClick={() => handleCancel(sub.organizationId, orgName)} disabled={updateSub.isPending} className="text-[10px] text-[#DD0C15] font-medium hover:underline disabled:opacity-50">{t.subscriptions.cancel}</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-[#EDEDED] flex-shrink-0">
          <span className="text-xs text-[#8B8B8B]">{t.common.showing} {subscriptions.length > 0 ? page * limit + 1 : 0}-{page * limit + subscriptions.length} {t.common.of} {total}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#8B8B8B] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg></button>
            {Array.from({ length: Math.min(Math.ceil(total / limit), 5) }).map((_, i) => (<button key={i} onClick={() => setPage(i)} className={`w-8 h-8 rounded-lg text-xs font-medium transition ${page === i ? 'bg-[#1F114C] text-white' : 'border border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'}`}>{i + 1}</button>))}
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="w-8 h-8 rounded-lg border border-[#EDEDED] flex items-center justify-center text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-40"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>
          </div>
        </div>
      </div>

      {/* Trials Alert */}
      {kpis.data && kpis.data.expiringTrials.length > 0 && (
        <TrialsAlert
          trials={kpis.data.expiringTrials}
          onExtendTrial={handleExtendTrial}
          isUpdating={updateSub.isPending}
        />
      )}
    </div>
  );
}
