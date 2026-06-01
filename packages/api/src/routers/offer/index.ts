import { mergeRouters } from '../../trpc';
import { offerCrudRouter } from './crud';
import { offerApprovalsRouter } from './approvals';
import { offerLifecycleRouter } from './lifecycle';
import { offerValidationsRouter } from './validations';

export const offerRouter = mergeRouters(
  offerCrudRouter,
  offerApprovalsRouter,
  offerLifecycleRouter,
  offerValidationsRouter,
);
