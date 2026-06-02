'use client';

import { useState } from 'react';
import { formatDate } from '../../../../../../lib/format-utils';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton } from '../../../../../../components';

function planBadge(plan: string) {
  const styles: Record<string, string> = {
    enterprise: 'bg-emerald-100 text-emerald-700',
    professional: 'bg-violet-100 text-violet-700',
    starter: 'bg-blue-100 text-blue-700',
    trial: 'bg-amber-100 text-amber-700',
  };
  const cls = styles[plan?.toLowerCase()] || 'bg-gray-100 text-gray-700';
  return (
    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${cls}`}>
      {plan?.charAt(0).toUpperCase() + plan?.slice(1)}
    </span>
  );
}

function trialDateColor(trialEndsAt: string | Date | null | undefined): string {
  if (!trialEndsAt) return 'text-[#8B8B8B]';
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 3) return 'text-[#DD0C15] font-medium';
  if (daysLeft <= 7) return 'text-amber-600 font-medium';
  return 'text-[#8B8B8B]';
}

interface OverviewProps {
  org: {
    id: string;
    name: string;
    plan: string | null;
    isActive: boolean;
    subscription: {
      id: string;
      plan: string;
      status: string;
      trialEndsAt: string | Date | null;
      currentPeriodStart: string | Date | null;
      currentPeriodEnd: string | Date | null;
      stripeCustomerId: string | null;
      stripeSubscriptionId: string | null;
    } | null;
    billingProfile: {
      companyName: string | null;
      taxId: string | null;
      billingEmail: string | null;
    } | null;
    companies: Array<{
      id: string;
      name: string;
      businessUnits: Array<{
        id: string;
        name: string;
        teams: Array<{ id: string; name: string }>;
      }>;
    }>;
    _count: {
      users: number;
      vacancies: number;
      invoices: number;
      invitations: number;
    };
  };
}

function StatCard({ label, value, sub, icon, color }: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[#8B8B8B] font-medium uppercase tracking-wide">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>{icon}</div>
      </div>
      <div className="text-2xl font-bold text-[#333]">{value}</div>
      {sub && <div className="text-xs text-[#8B8B8B] mt-1">{sub}</div>}
    </div>
  );
}

function SubscriptionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    trialing: 'bg-amber-100 text-amber-700',
    past_due: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{status}</span>;
}

export function OverviewSection({ org }: OverviewProps) {
  const { t } = useI18n();
  const [showStripeIds, setShowStripeIds] = useState(false);
  const [expandedCompanies, setExpandedCompanies] = useState<Set<string>>(new Set());

  const sub = org.subscription;
  const plan = org.plan || sub?.plan || 'trial';

  const trialDaysLeft = sub?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  const toggleCompany = (id: string) => {
    setExpandedCompanies((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Usuarios"
          value={org._count.users}
          sub="activos"
          color="bg-[#1F114C]/10"
          icon={<svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" /></svg>}
        />
        <StatCard
          label="Vacantes"
          value={org._count.vacancies}
          color="bg-blue-50"
          icon={<svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" /></svg>}
        />
        <StatCard
          label="Invitaciones Pendientes"
          value={org._count.invitations}
          color="bg-amber-50"
          icon={<svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" /></svg>}
        />
        <StatCard
          label="Suscripcion"
          value={plan.charAt(0).toUpperCase() + plan.slice(1)}
          sub={sub ? sub.status : 'Sin suscripcion'}
          color="bg-emerald-50"
          icon={<svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}
        />
      </div>

      {/* Subscription card */}
      {sub && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <h3 className="text-sm font-semibold text-[#333] mb-4">Suscripcion</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <div>
              <span className="text-xs text-[#8B8B8B]">Plan</span>
              <div className="mt-0.5">{planBadge(plan)}</div>
            </div>
            <div>
              <span className="text-xs text-[#8B8B8B]">Estado</span>
              <div className="mt-0.5"><SubscriptionStatusBadge status={sub.status} /></div>
            </div>
            {sub.status === 'trialing' && sub.trialEndsAt && (
              <div>
                <span className="text-xs text-[#8B8B8B]">Trial Vence</span>
                <div className={`text-sm mt-0.5 font-medium ${trialDateColor(sub.trialEndsAt)}`}>
                  {formatDate(sub.trialEndsAt)} ({trialDaysLeft} dias restantes)
                </div>
              </div>
            )}
            {sub.currentPeriodStart && (
              <div>
                <span className="text-xs text-[#8B8B8B]">Periodo Actual</span>
                <div className="text-sm text-[#585858] mt-0.5">
                  {formatDate(sub.currentPeriodStart)} - {formatDate(sub.currentPeriodEnd)}
                </div>
              </div>
            )}
          </div>

          {/* Collapsible Stripe IDs */}
          {(sub.stripeCustomerId || sub.stripeSubscriptionId) && (
            <div className="mt-4 pt-3 border-t border-[#EDEDED]">
              <button onClick={() => setShowStripeIds(!showStripeIds)} className="text-xs text-[#8B8B8B] hover:text-[#585858] flex items-center gap-1 transition">
                <svg className={`w-3 h-3 transition-transform ${showStripeIds ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
                Stripe IDs (debug)
              </button>
              {showStripeIds && (
                <div className="mt-2 space-y-1">
                  {sub.stripeCustomerId && (
                    <div className="text-xs"><span className="text-[#8B8B8B]">Customer: </span><code className="text-[#585858] font-mono bg-[#F6F6F6] px-1.5 py-0.5 rounded">{sub.stripeCustomerId}</code></div>
                  )}
                  {sub.stripeSubscriptionId && (
                    <div className="text-xs"><span className="text-[#8B8B8B]">Subscription: </span><code className="text-[#585858] font-mono bg-[#F6F6F6] px-1.5 py-0.5 rounded">{sub.stripeSubscriptionId}</code></div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Company hierarchy */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-semibold text-[#333] mb-4">Estructura Organizacional</h3>
        {org.companies.length === 0 ? (
          <p className="text-xs text-[#8B8B8B]">No hay empresas configuradas</p>
        ) : (
          <div className="space-y-2">
            {org.companies.map((company) => {
              const isExpanded = expandedCompanies.has(company.id);
              return (
                <div key={company.id}>
                  <button onClick={() => toggleCompany(company.id)} className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg hover:bg-[#FAFAFA] transition">
                    <svg className={`w-3.5 h-3.5 text-[#8B8B8B] transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
                    <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" /></svg>
                    <span className="text-sm font-medium text-[#333]">{company.name}</span>
                    <span className="text-[10px] text-[#8B8B8B] ml-1">({company.businessUnits.length} unidades)</span>
                  </button>
                  {isExpanded && company.businessUnits.length > 0 && (
                    <div className="ml-8 mt-1 space-y-1">
                      {company.businessUnits.map((bu) => (
                        <div key={bu.id}>
                          <div className="flex items-center gap-2 px-3 py-1.5">
                            <svg className="w-3.5 h-3.5 text-blue-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" /></svg>
                            <span className="text-xs text-[#585858]">{bu.name}</span>
                            <span className="text-[10px] text-[#8B8B8B]">({bu.teams.length} equipos)</span>
                          </div>
                          {bu.teams.length > 0 && (
                            <div className="ml-7 space-y-0.5">
                              {bu.teams.map((team) => (
                                <div key={team.id} className="flex items-center gap-2 px-3 py-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-[#EDEDED]" />
                                  <span className="text-xs text-[#8B8B8B]">{team.name}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Billing profile summary */}
      {org.billingProfile && (
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#333]">Perfil de Facturacion</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-xs text-[#8B8B8B]">Empresa</span>
              <p className="text-sm text-[#333] mt-0.5">{org.billingProfile.companyName || '\u2014'}</p>
            </div>
            <div>
              <span className="text-xs text-[#8B8B8B]">NIT / Tax ID</span>
              <p className="text-sm text-[#333] mt-0.5">{org.billingProfile.taxId || '\u2014'}</p>
            </div>
            <div>
              <span className="text-xs text-[#8B8B8B]">Email de Facturacion</span>
              <p className="text-sm text-[#333] mt-0.5">{org.billingProfile.billingEmail || '\u2014'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
