import type { AppRouter } from '@tims/api';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutput = inferRouterOutputs<AppRouter>;

// Platform router outputs
export type InvoiceListItem = RouterOutput['platform']['listInvoices']['invoices'][number];
export type InvoiceDetail = RouterOutput['platform']['getInvoice'];
export type OrganizationListItem = RouterOutput['platform']['listOrganizations']['organizations'][number];
export type SubscriptionListItem = RouterOutput['platform']['listSubscriptions']['subscriptions'][number];
export type InvitationListItem = RouterOutput['platform']['listInvitations']['invitations'][number];
export type UserListItem = RouterOutput['platform']['listAllUsers']['users'][number];
export type BillingProfileData = RouterOutput['platform']['getBillingProfile'];
export type MrrTrendItem = RouterOutput['platform']['getMrrTrend'][number];
export type SubscriptionKpis = RouterOutput['platform']['getSubscriptionKpis'];
export type ExpiringTrial = SubscriptionKpis['expiringTrials'][number];

// Platform owner emails
export type PlatformOwnerEmailList = RouterOutput['platform']['listPlatformOwnerEmails'];

// Audit logs
export type AuditLogEntry = RouterOutput['platform']['getCrossOrgAuditLogs']['logs'][number];

// AI Agents
export type AiAgentItem = RouterOutput['platform']['listAiAgents'][number];

// System Health
export type SystemHealthData = RouterOutput['platform']['getSystemHealth'];
export type HealthService = NonNullable<SystemHealthData>['services'][number];
export type HealthServiceMetric = NonNullable<HealthService['metrics']>[number];
export type HealthError = NonNullable<SystemHealthData>['recentErrors'][number];
