import { mergeRouters } from '../../trpc';
import { offerCrudRouter } from './crud';
import { offerApprovalsRouter } from './approvals';
import { offerLifecycleRouter } from './lifecycle';
import { offerValidationsRouter } from './validations';
import { offerSigningRouter } from './signing';
import { offerWithdrawRouter } from './withdraw';

export const offerRouter = mergeRouters(
  offerCrudRouter,
  offerApprovalsRouter,
  offerLifecycleRouter,
  offerValidationsRouter,
  offerSigningRouter,
  offerWithdrawRouter,
);
