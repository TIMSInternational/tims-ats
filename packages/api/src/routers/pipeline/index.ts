import { mergeRouters } from '../../trpc';
import { pipelineStagesRouter } from './stages';
import { pipelineMovementsRouter } from './movements';
import { pipelineAnalyticsRouter } from './analytics';

export const pipelineRouter = mergeRouters(
  pipelineStagesRouter,
  pipelineMovementsRouter,
  pipelineAnalyticsRouter,
);
