import { mergeRouters } from '../../trpc';
import { vacancyCrudRouter } from './crud';
import { vacancyApprovalsRouter } from './approvals';
import { vacancyAiRouter } from './ai';
import { vacancyJobProfileRouter } from './job-profile';
import { vacancyChannelsRouter } from './channels';
import { vacancyStatsRouter } from './stats';

export const vacancyRouter = mergeRouters(
  vacancyCrudRouter,
  vacancyApprovalsRouter,
  vacancyAiRouter,
  vacancyJobProfileRouter,
  vacancyChannelsRouter,
  vacancyStatsRouter,
);
