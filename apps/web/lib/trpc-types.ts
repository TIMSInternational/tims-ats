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
export type VacancyDescriptionVariants = RouterOutput['vacancy']['generateDescription'];
export type InclusiveLanguageResult = RouterOutput['vacancy']['checkInclusiveLanguage'];

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
export type InterviewDetail = RouterOutput['interview']['getById'];
export type InterviewEvaluator = InterviewDetail['evaluators'][number];

// AI Voice Interview (recruiter result view — Task 8)
export type AiInterviewResult = RouterOutput['aiInterview']['getResult'];
export type AiInterviewCreateResult = RouterOutput['aiInterview']['create'];

// Interview AI (interview-room buttons — all three are budget-spending mutations)
export type InterviewGuideResult = RouterOutput['interview']['generateGuide'];
export type InterviewGuideSection = InterviewGuideResult['sections'][number];
export type InterviewSummaryResult = RouterOutput['interview']['generateSummary'];
export type InterviewBiasResult = RouterOutput['interview']['detectBias'];
export type InterviewBiasIndicator = InterviewBiasResult['biasIndicators'][number];

// Entitlements admin console (Slice 2a)
export type EntitlementItem = RouterOutput['platform']['getOrgEntitlements'][number];
export type EntitlementPlanItem = RouterOutput['platform']['listPlans'][number];

// Usage billing console (Slice 2b)
export type UsageBillingPreview = RouterOutput['platform']['getUsageBillingPreview'];
export type UsageBillingLine = UsageBillingPreview['lines'][number];

// Organization — business units & membership (Wave 2.5 slice 7a)
export type CompanyListItem = RouterOutput['organization']['listCompanies'][number];
export type BusinessUnitListItem = RouterOutput['organization']['listBusinessUnits'][number];
export type UnitMember = RouterOutput['organization']['listUnitMembers'][number];

// Nine-box — calibration committee (Wave 2.5 slice 7a)

// Offer (types will be added when offer service is refactored in Phase 1.4)

// Performance — low-progress alerts panel (Sprint 1.4 Task 2)
export type LowProgressAlertsResult = RouterOutput['performance']['getLowProgressAlerts'];
export type LowProgressOkr = LowProgressAlertsResult['lowProgressOkrs'][number];
export type OverdueCommitment = LowProgressAlertsResult['overdueCommitments'][number];

// Evaluation 360 (Sprint 1.7 Slice 5) — participant "My 360" + admin console. The TS
// evaluation360 router has been deleted (C# cutover complete), so these are re-exported from the
// C#-only FE wrapper's hand-declared types instead of inferRouterOutputs — same names, so every
// consumer (cycle-row.tsx, cycle-table.tsx, rater-task-card.tsx, report-bucket-card.tsx) needs no
// changes.
export type {
  EvaluationCycle as Eval360Cycle,
  CycleProgress as Eval360CycleProgress,
  CycleProgressRow as Eval360ProgressRow,
  RaterTask as Eval360RaterTask,
  MyReport as Eval360Report,
  ReportBucket as Eval360ReportBucket,
  MyReportCycle as Eval360ReportCycle,
} from './platform-api/evaluation360';
