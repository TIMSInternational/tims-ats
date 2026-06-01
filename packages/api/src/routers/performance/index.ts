import { mergeRouters } from '../../trpc';
import { performanceOkrsRouter } from './okrs';
import { performanceCoachingRouter } from './coaching';
import { performanceFeedbackRouter } from './feedback';
import { performanceDashboardRouter } from './dashboard';

export const performanceRouter = mergeRouters(
  performanceOkrsRouter,
  performanceCoachingRouter,
  performanceFeedbackRouter,
  performanceDashboardRouter,
);
