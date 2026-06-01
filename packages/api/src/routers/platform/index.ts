import { mergeRouters } from '../../trpc';
import { dashboardRouter } from './dashboard';
import { organizationsRouter } from './organizations';
import { usersRouter } from './users';
import { subscriptionsRouter } from './subscriptions';
import { invoicesRouter } from './invoices';
import { invitationsRouter } from './invitations';
import { aiAgentsRouter } from './ai-agents';
import { systemRouter } from './system';

export const platformRouter = mergeRouters(
  dashboardRouter,
  organizationsRouter,
  usersRouter,
  subscriptionsRouter,
  invoicesRouter,
  invitationsRouter,
  aiAgentsRouter,
  systemRouter,
);
