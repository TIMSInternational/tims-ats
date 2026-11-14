'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../lib/i18n/format';
import { formatCurrency } from '../../../../../../lib/format-utils';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, TEXT_LINK_CLASSES } from '../../../../../../components';
import { invoiceStatus } from '../../plan-label';
import { BillingProfileDrawer } from '../../../invoices/billing-drawer';
import { UsageBillingPanel } from './usage-billing-panel';

function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

const CARD = 'rounded-xl bg-white shadow-card';
const DT = 'text-callout text-secondary';
const DD = 'mt-0.5 break-words text-body text-primary';
const TH = 'px-4 py-2.5 text-callout font-semibold text-secondary';

export function BillingSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [showDrawer, setShowDrawer] = useState(false);

  const profile = trpc.platform.getBillingProfile.useQuery({ organizationId });
  const invoices = trpc.platform.getOrgInvoices.useQuery({ organizationId });

  const bp = profile.data;
  const invData = invoices.data;

  const o = t.organizations;
  const plusIcon = (
    <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  );

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Billing profile card */}
      <section className={`${CARD} p-4 md:p-5`} aria-labelledby="org-billing-profile">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="org-billing-profile" className="text-subheading font-semibold text-primary">{t.billing.orgBillingProfileTitle}</h2>
          <Button size="sm" variant="secondary" onClick={() => setShowDrawer(true)}>
            {o.editEllipsis}
          </Button>
        </div>
        {profile.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}><Skeleton className="mb-1 h-3 w-20" /><Skeleton className="h-4 w-32" /></div>
            ))}
          </div>
        ) : profile.isError ? (
          <ErrorState onRetry={() => profile.refetch()} error={profile.error} size="compact" />
        ) : bp ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className={DT}>{o.billingCompany}</dt><dd className={DD}>{bp.companyName || '\u2014'}</dd></div>
            <div><dt className={DT}>{t.invoices.taxId}</dt><dd className={DD}>{bp.taxId || '\u2014'}</dd></div>
            <div><dt className={DT}>{t.invoices.billingEmail}</dt><dd className={`${DD} break-all`}>{bp.billingEmail || '\u2014'}</dd></div>
            <div><dt className={DT}>{o.billingAddress}</dt><dd className={DD}>{bp.address || '\u2014'}</dd></div>
            <div><dt className={DT}>{o.billingPhone}</dt><dd className={DD}>{bp.billingPhone || '\u2014'}</dd></div>
            <div><dt className={DT}>{o.billingCity}</dt><dd className={DD}>{bp.city || '\u2014'}{bp.state ? `, ${bp.state}` : ''}</dd></div>
          </dl>
        ) : (
          <p className="text-body text-secondary">{t.billing.noOrgBillingProfile}</p>
        )}
      </section>

      {/* Outstanding summary */}
      {invData && (invData.pendingCount > 0 || invData.overdueCount > 0) && (
        <div className="flex flex-wrap gap-3">
          <p className="flex flex-wrap items-center gap-2 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-body font-medium text-warning">
            {formatMessage(o.outstandingAmount, {
              amount: formatCurrency(Number(invData.outstandingAmount), invData.outstandingCurrency ?? 'USD'),
            })}
            <span className="text-callout font-normal">{formatMessage(o.pendingInvoicesN, { count: invData.pendingCount })}</span>
          </p>
          {invData.overdueCount > 0 && (
            <p className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-body font-medium text-danger">
              <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
              {formatMessage(o.overdueN, { count: invData.overdueCount })}
            </p>
          )}
        </div>
      )}

      {/* Recent invoices */}
      <section className={`${CARD} overflow-hidden`} aria-labelledby="org-billing-invoices">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-5">
          <h2 id="org-billing-invoices" className="text-subheading font-semibold text-primary">{t.billing.orgRecentInvoices}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/platform/invoices?org=${organizationId}`} className={`${TEXT_LINK_CLASSES} text-body`}>
              {o.viewAllInvoices}
            </Link>
            <Button size="sm" icon={plusIcon} onClick={() => router.push(`/platform/invoices?create=true&org=${organizationId}`)}>
              {o.newInvoice}
            </Button>
          </div>
        </div>
        {invoices.isLoading ? (
          <div className="space-y-3 p-5" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-14 rounded-full" /><Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : invoices.isError ? (
          <ErrorState onRetry={() => invoices.refetch()} error={invoices.error} size="compact" />
        ) : !invData || invData.invoices.length === 0 ? (
          <EmptyState size="compact" title={t.billing.noOrgInvoices} />
        ) : (
          <>
            <ul className="divide-y divide-border sm:hidden">
              {invData.invoices.map((inv) => {
                const st = invoiceStatus(inv.status, t);
                return (
                  <li key={inv.id} className="space-y-1 px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-body font-medium text-brand">{inv.invoiceNumber}</span>
                      <span className="text-body font-medium tabular-nums text-primary">{formatCurrency(Number(inv.amount), inv.currency)}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-callout text-secondary">
                      <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                      <span>{formatMessage(o.dueOn, { date: fmtDate(inv.dueDate) })}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="hidden overflow-x-auto sm:block"><table className="w-full min-w-[640px] text-left">
              <caption className="sr-only">{t.billing.orgRecentInvoices}</caption>
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TH}>{o.colInvoice}</th>
                  <th scope="col" className={`${TH} text-right`}>{t.common.amount}</th>
                  <th scope="col" className={TH}>{t.common.status}</th>
                  <th scope="col" className={TH}>{t.common.date}</th>
                  <th scope="col" className={TH}>{o.colDue}</th>
                  <th scope="col" className={TH}>{o.colPaidOn}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {invData.invoices.map((inv) => {
                  const st = invoiceStatus(inv.status, t);
                  return (
                    <tr key={inv.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-2.5 text-body font-medium text-brand">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2.5 text-right text-body font-medium tabular-nums text-primary">{formatCurrency(Number(inv.amount), inv.currency)}</td>
                      <td className="px-4 py-2.5"><StatusBadge tone={st.tone}>{st.label}</StatusBadge></td>
                      <td className="px-4 py-2.5 text-callout text-secondary">{fmtDate(inv.invoiceDate)}</td>
                      <td className="px-4 py-2.5 text-callout text-secondary">{fmtDate(inv.dueDate)}</td>
                      <td className="px-4 py-2.5 text-callout text-secondary">{fmtDate(inv.paidAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      {/* Usage billing */}
      <UsageBillingPanel orgId={organizationId} />

      {showDrawer && <BillingProfileDrawer organizationId={organizationId} onClose={() => setShowDrawer(false)} />}
    </div>
  );
}
