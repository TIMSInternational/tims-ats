'use client';

import { useState } from 'react';
import { formatDate } from '../../../../../../lib/format-utils';
import { useI18n } from '../../../../../../lib/i18n';
import { formatMessage, pluralize } from '../../../../../../lib/i18n/format';
import { KpiCard, StatusBadge } from '../../../../../../components';
import { planLabel, subscriptionStatus } from '../../plan-label';

function trialDateColor(trialEndsAt: string | Date | null | undefined): string {
  if (!trialEndsAt) return 'text-secondary';
  const daysLeft = Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (daysLeft <= 3) return 'text-danger font-medium';
  if (daysLeft <= 7) return 'text-warning font-medium';
  return 'text-secondary';
}

const CARD = 'rounded-xl bg-white p-4 shadow-card md:p-5';
const DT = 'text-callout text-secondary';
const icon = (d: string) => (
  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

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

export function OverviewSection({ org }: OverviewProps) {
  const { t, locale } = useI18n();
  const o = t.organizations;
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

  const status = sub ? subscriptionStatus(sub.status, t) : null;

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Stat cards: plan and status live once, in the subscription card below. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4">
        <KpiCard
          label={o.statUsers}
          value={org._count.users}
          icon={icon('M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75')}
        />
        <KpiCard
          label={o.statVacancies}
          value={org._count.vacancies}
          icon={icon('M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M4 7h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2z')}
        />
        <KpiCard
          label={o.statPendingInvites}
          value={org._count.invitations}
          icon={icon('M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6')}
        />
      </div>

      {/* Subscription card */}
      <section className={CARD} aria-labelledby="org-overview-subscription">
        <h2 id="org-overview-subscription" className="mb-4 text-subheading font-semibold text-primary">{o.subscriptionTitle}</h2>
        {!sub || !status ? (
          <p className="text-body text-secondary">{o.noSubscription}</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <div>
              <dt className={DT}>{o.plan}</dt>
              <dd className="mt-0.5"><StatusBadge tone="brand" icon="none">{planLabel(plan, t)}</StatusBadge></dd>
            </div>
            <div>
              <dt className={DT}>{t.common.status}</dt>
              <dd className="mt-0.5"><StatusBadge tone={status.tone}>{status.label}</StatusBadge></dd>
            </div>
            {sub.status === 'trialing' && sub.trialEndsAt && (
              <div>
                <dt className={DT}>{o.trialExpires}</dt>
                <dd className={`mt-0.5 text-body ${trialDateColor(sub.trialEndsAt)}`}>
                  {formatDate(sub.trialEndsAt)} ({pluralize(trialDaysLeft ?? 0, { one: o.trialDaysLeftOne, other: o.trialDaysLeftOther }, locale)})
                </dd>
              </div>
            )}
            {sub.currentPeriodStart && (
              <div>
                <dt className={DT}>{o.currentPeriod}</dt>
                <dd className="mt-0.5 text-body text-primary">
                  {formatDate(sub.currentPeriodStart)} – {formatDate(sub.currentPeriodEnd)}
                </dd>
              </div>
            )}
          </dl>
        )}

        {/* Collapsible Stripe IDs */}
        {sub && (sub.stripeCustomerId || sub.stripeSubscriptionId) && (
          <div className="mt-4 border-t border-border pt-3">
            <button
              type="button"
              aria-expanded={showStripeIds}
              aria-controls="org-overview-stripe"
              onClick={() => setShowStripeIds(!showStripeIds)}
              className="flex items-center gap-1 text-callout text-secondary transition-colors hover:text-primary pointer-coarse:min-h-11"
            >
              <svg className={`size-3 transition-transform motion-reduce:transition-none ${showStripeIds ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
              {o.stripeIds}
            </button>
            {showStripeIds && (
              <dl id="org-overview-stripe" className="mt-2 space-y-1 text-callout">
                {sub.stripeCustomerId && (
                  <div className="flex flex-wrap gap-1"><dt className="text-secondary">{o.stripeCustomer}</dt><dd><code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono text-primary">{sub.stripeCustomerId}</code></dd></div>
                )}
                {sub.stripeSubscriptionId && (
                  <div className="flex flex-wrap gap-1"><dt className="text-secondary">{o.stripeSubscription}</dt><dd><code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono text-primary">{sub.stripeSubscriptionId}</code></dd></div>
                )}
              </dl>
            )}
          </div>
        )}
      </section>

      {/* Company hierarchy */}
      <section className={CARD} aria-labelledby="org-overview-structure">
        <h2 id="org-overview-structure" className="mb-4 text-subheading font-semibold text-primary">{o.orgStructure}</h2>
        {org.companies.length === 0 ? (
          <p className="text-body text-secondary">{o.noCompaniesConfigured}</p>
        ) : (
          <ul className="space-y-2">
            {org.companies.map((company) => {
              const isExpanded = expandedCompanies.has(company.id);
              return (
                <li key={company.id}>
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => toggleCompany(company.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-surface-hover pointer-coarse:min-h-11"
                  >
                    <svg className={`size-3.5 text-secondary transition-transform motion-reduce:transition-none ${isExpanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
                    <span className="text-body font-medium text-primary">{company.name}</span>
                    <span className="ml-1 text-callout text-secondary">{formatMessage(o.businessUnitsCount, { count: company.businessUnits.length })}</span>
                  </button>
                  {isExpanded && company.businessUnits.length > 0 && (
                    <ul className="ml-8 mt-1 space-y-1">
                      {company.businessUnits.map((bu) => (
                        <li key={bu.id}>
                          <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                            <span className="text-body text-primary">{bu.name}</span>
                            <span className="text-callout text-secondary">{formatMessage(o.teamsCount, { count: bu.teams.length })}</span>
                          </div>
                          {bu.teams.length > 0 && (
                            <ul className="ml-7 space-y-0.5">
                              {bu.teams.map((team) => (
                                <li key={team.id} className="flex items-center gap-2 px-3 py-1">
                                  <span className="size-1.5 rounded-full bg-border" aria-hidden="true" />
                                  <span className="text-callout text-secondary">{team.name}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Billing profile summary */}
      {org.billingProfile && (
        <section className={CARD} aria-labelledby="org-overview-billing">
          <h2 id="org-overview-billing" className="mb-3 text-subheading font-semibold text-primary">{o.billingProfileLabel}</h2>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className={DT}>{o.billingCompany}</dt>
              <dd className="mt-0.5 break-words text-body text-primary">{org.billingProfile.companyName || '\u2014'}</dd>
            </div>
            <div>
              <dt className={DT}>{o.nitTaxId}</dt>
              <dd className="mt-0.5 break-words text-body text-primary">{org.billingProfile.taxId || '\u2014'}</dd>
            </div>
            <div>
              <dt className={DT}>{o.billingEmailLabel}</dt>
              <dd className="mt-0.5 break-all text-body text-primary">{org.billingProfile.billingEmail || '\u2014'}</dd>
            </div>
          </dl>
        </section>
      )}
    </div>
  );
}
