import type { OrgPlan } from '@tims/db';

export type AttentionItem = {
  id: string;
  type: 'overdue_invoice' | 'expiring_trial' | 'failed_payment' | 'pending_invitation' | 'suspended_org';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  orgId?: string;
  orgName?: string;
  actionUrl: string;
  actionLabel: string;
  amount?: number;
  currency?: string;
  daysUntil?: number;
};

type OrgRef = { id: string; name: string };

type OverdueInvoiceRow = {
  id: string;
  amount: number;
  currency: string;
  dueDate: Date | null;
  organization: OrgRef;
};

type ExpiringTrialRow = {
  id: string;
  trialEndsAt: Date | null;
  organization: OrgRef;
};

type PastDueSubRow = {
  id: string;
  plan: OrgPlan;
  organization: OrgRef;
};

type StaleInvitationRow = {
  id: string;
  email: string;
  createdAt: Date;
  organization: OrgRef | null;
};

type SuspendedOrgRow = OrgRef;

/**
 * Builds the sorted list of "attention" items (overdue invoices, expiring trials,
 * failed payments, stale invitations, suspended orgs) from pre-fetched query rows.
 * Pure: no DB access. Sort order is critical first, then warning, then info; within
 * a severity, by daysUntil ascending (most urgent first).
 */
export function buildAttentionItems(args: {
  now: Date;
  planPrices: Record<string, number>;
  overdueInvoices: OverdueInvoiceRow[];
  expiringTrials: ExpiringTrialRow[];
  pastDueSubs: PastDueSubRow[];
  staleInvitations: StaleInvitationRow[];
  suspendedOrgs: SuspendedOrgRow[];
}): AttentionItem[] {
  const { now, planPrices, overdueInvoices, expiringTrials, pastDueSubs, staleInvitations, suspendedOrgs } = args;

  const items: AttentionItem[] = [];

  for (const inv of overdueInvoices) {
    const daysPastDue = inv.dueDate
      ? Math.floor((now.getTime() - inv.dueDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    items.push({
      id: inv.id,
      type: 'overdue_invoice',
      severity: 'critical',
      title: `Factura vencida - ${inv.organization.name}`,
      description: `$${inv.amount.toLocaleString()} ${inv.currency} vencida hace ${daysPastDue} dias`,
      orgId: inv.organization.id,
      orgName: inv.organization.name,
      actionUrl: `/platform/invoices?org=${inv.organization.id}`,
      actionLabel: 'Ver factura',
      amount: inv.amount,
      currency: inv.currency,
      daysUntil: -daysPastDue,
    });
  }

  for (const sub of expiringTrials) {
    const daysLeft = sub.trialEndsAt
      ? Math.ceil((sub.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      : 0;
    items.push({
      id: sub.id,
      type: 'expiring_trial',
      severity: 'warning',
      title: `Trial expira pronto - ${sub.organization.name}`,
      description: `El periodo de prueba expira en ${daysLeft} dia${daysLeft !== 1 ? 's' : ''}`,
      orgId: sub.organization.id,
      orgName: sub.organization.name,
      actionUrl: `/platform/organizations/${sub.organization.id}`,
      actionLabel: 'Gestionar',
      daysUntil: daysLeft,
    });
  }

  for (const sub of pastDueSubs) {
    const price = planPrices[sub.plan] || 0;
    items.push({
      id: sub.id,
      type: 'failed_payment',
      severity: 'critical',
      title: `Pago fallido - ${sub.organization.name}`,
      description: `Suscripcion ${sub.plan} con pago pendiente ($${price}/mes)`,
      orgId: sub.organization.id,
      orgName: sub.organization.name,
      actionUrl: `/platform/subscriptions?org=${sub.organization.id}`,
      actionLabel: 'Resolver pago',
      amount: price,
      currency: 'USD',
    });
  }

  for (const inv of staleInvitations) {
    const daysSinceSent = Math.floor(
      (now.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    items.push({
      id: inv.id,
      type: 'pending_invitation',
      severity: 'info',
      title: `Invitacion sin aceptar - ${inv.email}`,
      description: `Enviada hace ${daysSinceSent} dias${inv.organization ? ` para ${inv.organization.name}` : ''}`,
      orgId: inv.organization?.id,
      orgName: inv.organization?.name,
      actionUrl: `/platform/invitations`,
      actionLabel: 'Reenviar',
    });
  }

  for (const org of suspendedOrgs) {
    items.push({
      id: org.id,
      type: 'suspended_org',
      severity: 'warning',
      title: `Organizacion suspendida - ${org.name}`,
      description: `La organizacion esta desactivada y sus usuarios no pueden acceder`,
      orgId: org.id,
      orgName: org.name,
      actionUrl: `/platform/organizations/${org.id}`,
      actionLabel: 'Revisar',
    });
  }

  // Sort: critical first, then warning, then info
  const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  items.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;
    // Within same severity, sort by daysUntil ascending (most urgent first)
    const aUrgency = a.daysUntil ?? 0;
    const bUrgency = b.daysUntil ?? 0;
    return aUrgency - bUrgency;
  });

  return items;
}

/**
 * Static nav pages used by the platform global search. Matched by name or keyword.
 */
export const SEARCH_PAGES = [
  { name: 'Dashboard', href: '/dashboard', keywords: 'inicio home panel' },
  { name: 'Organizaciones', href: '/platform/organizations', keywords: 'orgs empresas clients' },
  { name: 'Suscripciones', href: '/platform/subscriptions', keywords: 'billing planes pagos facturacion stripe' },
  { name: 'Usuarios', href: '/platform/users', keywords: 'users personas cuentas' },
  { name: 'Salud del Sistema', href: '/platform/health', keywords: 'health status uptime monitoreo' },
  { name: 'Feature Flags', href: '/platform/feature-flags', keywords: 'flags toggles features modulos' },
  { name: 'Agentes IA', href: '/platform/ai-agents', keywords: 'ai agents bedrock claude haiku sonnet inteligencia artificial agentes' },
  { name: 'Analytics', href: '/platform/analytics', keywords: 'metricas estadisticas growth crecimiento' },
  { name: 'Auditoria', href: '/platform/audit', keywords: 'audit logs registro actividad' },
  { name: 'Soporte', href: '/platform/support', keywords: 'support ayuda impersonar reset' },
  { name: 'Facturas', href: '/platform/invoices', keywords: 'invoices facturas pagos billing cobros' },
  { name: 'Invitaciones', href: '/platform/invitations', keywords: 'invitations invitaciones onboarding invite' },
];
