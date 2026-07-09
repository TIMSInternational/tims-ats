import { mergeRouters } from '../../trpc';
import { dashboardRouter } from './dashboard';
import { dashboardForecastRouter } from './dashboard-forecast';
import { dashboardChurnRouter } from './dashboard-churn';
import { dashboardUpsellRouter } from './dashboard-upsell';
import { organizationsRouter } from './organizations';
import { usersRouter } from './users';
import { subscriptionsRouter } from './subscriptions';
import { invoicesRouter } from './invoices';
import { invitationsRouter } from './invitations';
import { aiAgentsRouter } from './ai-agents';
import { systemRouter } from './system';
import { dataRequestsRouter } from './data-requests';
import { entitlementsAdminRouter } from './entitlements';
import { usageBillingRouter } from './usage-billing';

export const platformRouter = mergeRouters(
  dashboardRouter,
  dashboardForecastRouter,
  dashboardChurnRouter,
  dashboardUpsellRouter,
  organizationsRouter,
  usersRouter,
  subscriptionsRouter,
  invoicesRouter,
  invitationsRouter,
  aiAgentsRouter,
  systemRouter,
  dataRequestsRouter,
  entitlementsAdminRouter,
  usageBillingRouter,
);
