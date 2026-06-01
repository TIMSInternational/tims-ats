import { mergeRouters } from '../../trpc';
import { interviewCrudRouter } from './crud';
import { interviewScorecardsRouter } from './scorecards';
import { interviewAiRouter } from './ai';
import { interviewMediaRouter } from './media';

export const interviewRouter = mergeRouters(
  interviewCrudRouter,
  interviewScorecardsRouter,
  interviewAiRouter,
  interviewMediaRouter,
);
