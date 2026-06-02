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
export type SubscriptionDetail = RouterOutput['platform']['getSubscriptionDetail'];

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

// Vacancy
export type VacancyListItem = RouterOutput['vacancy']['list']['items'][number];
export type VacancyDetail = RouterOutput['vacancy']['getById'];
export type VacancyDashboardKpis = RouterOutput['vacancy']['getDashboardKpis'];
export type VacancyStats = RouterOutput['vacancy']['getStats'];

// Candidate
export type CandidateListItem = RouterOutput['candidate']['list']['items'][number];
export type CandidateDetail = RouterOutput['candidate']['getById'];
export type CandidateKpis = RouterOutput['candidate']['getDashboardKpis'];
export type CandidateTimelineEvent = RouterOutput['candidate']['getTimeline'][number];

// Pipeline
export type PipelineBoardData = RouterOutput['pipeline']['getBoard'];
export type PipelineStageWithApps = PipelineBoardData['stages'][number];
export type PipelineApplicationCard = PipelineStageWithApps['applications'][number];
export type PipelineFunnel = RouterOutput['pipeline']['getFunnel'];

// Interview
export type InterviewListItem = RouterOutput['interview']['list']['items'][number];
export type InterviewListResult = RouterOutput['interview']['list'];

// Offer (types will be added when offer service is refactored in Phase 1.4)
