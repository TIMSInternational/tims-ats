import { router, createCallerFactory } from './trpc';
import { authRouter } from './routers/auth';
import { organizationRouter } from './routers/organization';
import { userRouter } from './routers/user';
import { vacancyRouter } from './routers/vacancy';
import { pipelineRouter } from './routers/pipeline';
import { candidateRouter } from './routers/candidate';
import { assessmentRouter } from './routers/assessment';
import { interviewRouter } from './routers/interview';
import { offerRouter } from './routers/offer';
import { onboardingRouter } from './routers/onboarding';
import { performanceRouter } from './routers/performance';
import { learningRouter } from './routers/learning';
import { nineboxRouter } from './routers/ninebox';
import { successionRouter } from './routers/succession';
import { teamIntelRouter } from './routers/teamIntel';
import { engagementRouter } from './routers/engagement';
import { deiRouter } from './routers/dei';
import { compensationRouter } from './routers/compensation';
import { monitoringRouter } from './routers/monitoring';
import { integrationRouter } from './routers/integration';
import { auditRouter } from './routers/audit';
import { billingRouter } from './routers/billing';
import { featureFlagRouter } from './routers/featureFlag';
import { portalRouter } from './routers/portal';
import { notificationRouter } from './routers/notification';
import { platformRouter } from './routers/platform';
import { candidatePortalRouter } from './routers/candidate-portal';
import { externalRouter } from './routers/external';
import { consentRouter } from './routers/consent';
import { aiInterviewRouter } from './routers/ai-interview';
import { entitlementRouter } from './routers/entitlement';
import { fitEngineRouter } from './routers/fit-engine';
import { evaluation360Router } from './routers/evaluation360';

export { createContext } from './context';
export type { TRPCContext } from './context';
export {
  signImpersonationToken,
  verifyImpersonationToken,
  readImpersonationCookie,
  IMPERSONATION_COOKIE,
} from './lib/impersonation';
export { evaluateAlertRules } from './services/alert-evaluation.service';
export type { AlertEvaluationSummary } from './services/alert-evaluation.service';
export { candidatePortalService } from './services/candidate-portal.service';
export { handleStripeWebhook, isWebhookVerificationError } from './services/billing-webhook.service';
export type { WebhookResult } from './services/billing-webhook.service';
export { verifyWebhookSignature } from './integrations/elevenlabs';
export { aiInterviewService } from './services/ai-interview.service';
export type { TranscriptTurn } from './services/ai-interview.service';
export { provisionOrgDefaults, provisionOrgEntitlements } from './services/org-provisioning';

export const appRouter = router({
  auth: authRouter,
  organization: organizationRouter,
  user: userRouter,
  vacancy: vacancyRouter,
  pipeline: pipelineRouter,
  candidate: candidateRouter,
  assessment: assessmentRouter,
  interview: interviewRouter,
  offer: offerRouter,
  onboarding: onboardingRouter,
  performance: performanceRouter,
  learning: learningRouter,
  ninebox: nineboxRouter,
  succession: successionRouter,
  teamIntel: teamIntelRouter,
  engagement: engagementRouter,
  dei: deiRouter,
  compensation: compensationRouter,
  monitoring: monitoringRouter,
  integration: integrationRouter,
  audit: auditRouter,
  billing: billingRouter,
  featureFlag: featureFlagRouter,
  portal: portalRouter,
  candidatePortal: candidatePortalRouter,
  external: externalRouter,
  consent: consentRouter,
  notification: notificationRouter,
  platform: platformRouter,
  aiInterview: aiInterviewRouter,
  entitlement: entitlementRouter,
  fitEngine: fitEngineRouter,
  evaluation360: evaluation360Router,
});

export const createCaller = createCallerFactory(appRouter);
export type AppRouter = typeof appRouter;
