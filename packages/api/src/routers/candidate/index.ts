import { mergeRouters } from '../../trpc';
import { candidateCrudRouter } from './crud';
import { candidateDocumentsRouter } from './documents';
import { candidateTagsRouter } from './tags';
import { candidatePoolRouter } from './pool';
import { candidateTimelineRouter } from './timeline';

export const candidateRouter = mergeRouters(
  candidateCrudRouter,
  candidateDocumentsRouter,
  candidateTagsRouter,
  candidatePoolRouter,
  candidateTimelineRouter,
);
