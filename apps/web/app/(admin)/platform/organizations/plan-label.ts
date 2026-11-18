import type { useI18n } from '../../../../lib/i18n';

type Translations = ReturnType<typeof useI18n>['t'];

/** The subscription plans a platform owner can pick, in price order. */
export const PLAN_KEYS = ['trial', 'starter', 'professional', 'enterprise'] as const;

/** A plan's display name from the billing labels; unknown plans fall back to the raw value. */
export function planLabel(plan: string | null | undefined, t: Translations): string {
  const labels: Record<string, string> = {
    trial: t.billing.planTrial,
    starter: t.billing.planStarter,
    professional: t.billing.planProfessional,
    enterprise: t.billing.planEnterprise,
  };
  const key = (plan ?? '').toLowerCase();
  return labels[key] ?? plan ?? '';
}

/** A subscription status as a word and a StatusBadge tone (never the raw enum). */
export function subscriptionStatus(
  status: string | null | undefined,
  t: Translations,
): { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' } {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return { label: t.subscriptions.statusActive, tone: 'success' };
    case 'trialing':
      return { label: t.subscriptions.statusTrialing, tone: 'info' };
    case 'past_due':
      return { label: t.subscriptions.statusPastDue, tone: 'danger' };
    case 'canceled':
    case 'cancelled':
      return { label: t.subscriptions.statusCanceled, tone: 'neutral' };
    default:
      return { label: status || '—', tone: 'neutral' };
  }
}

/** An invoice status as a word and a StatusBadge tone. */
export function invoiceStatus(
  status: string | null | undefined,
  t: Translations,
): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  switch ((status ?? '').toLowerCase()) {
    case 'paid':
      return { label: t.invoices.statusPaid, tone: 'success' };
    case 'pending':
      return { label: t.invoices.statusPending, tone: 'warning' };
    case 'overdue':
      return { label: t.invoices.statusOverdue, tone: 'danger' };
    case 'void':
      return { label: t.invoices.statusVoid, tone: 'neutral' };
    case 'draft':
      return { label: t.invoices.statusDraft, tone: 'neutral' };
    default:
      return { label: status || '—', tone: 'neutral' };
  }
}
