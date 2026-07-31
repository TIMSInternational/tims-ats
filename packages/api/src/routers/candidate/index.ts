import { mergeRouters, router } from '../../trpc';
import { candidateCrudRouter } from './crud';
import { candidateDocumentsRouter } from './documents';
import { candidateTagsRouter } from './tags';
import { candidatePoolRouter } from './pool';
import { candidateTimelineRouter } from './timeline';
import { candidateAiRouter } from './ai';

export const candidateRouter = mergeRouters(
  candidateCrudRouter,
  candidateDocumentsRouter,
  candidateTagsRouter,
  candidateTimelineRouter,
  candidateAiRouter,
  router({
    pool: candidatePoolRouter,
  }),
);
