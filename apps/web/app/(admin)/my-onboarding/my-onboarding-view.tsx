'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { usePermissions } from '../../../lib/permissions';
import { MyPlanSummary } from './my-plan-summary';
import { MyTaskList } from './my-task-list';
import { MyCheckInList } from './my-check-in-list';

// `mine: true` makes the SERVER return only plans where the caller is the hire
// (without it the own-scoped list also returns plans where the caller is the
// BUDDY, and a paginated client-side search could miss the caller's own plan).
// One active plan per hire is enforced server-side, so limit 1 is enough; the
// user-id match below is kept as a belt-and-braces check.
const PLAN_LOOKUP_LIMIT = 1;

export function MyOnboardingView() {
  const { t } = useI18n();
  const m = t.myOnboarding;
  const { userId } = usePermissions();

  const plans = trpc.onboarding.list.useQuery(
    { limit: PLAN_LOOKUP_LIMIT, status: 'active', mine: true },
    { enabled: !!userId },
  );
  const ownPlan = plans.data?.plans.find((plan) => plan.user.id === userId);
  const detail = trpc.onboarding.getById.useQuery({ id: ownPlan?.id ?? '' }, { enabled: !!ownPlan });

  if (plans.isError || detail.isError) {
    return <p className="rounded-xl border border-red-100 bg-red-50 p-4 text-[13px] text-red-700">{m.loadError}</p>;
  }
  if (!userId || plans.isLoading || (ownPlan && detail.isLoading)) {
    return <div className="h-40 animate-pulse rounded-xl bg-[#F4F4F6]" aria-busy="true" />;
  }
  if (!ownPlan || !detail.data) {
    return (
      <div className="rounded-xl border border-[#EDEDED] bg-white p-8 text-center">
        <p className="text-[14px] font-semibold text-[#1F114C]">{m.noPlan}</p>
        <p className="mt-1 text-[13px] text-[#585858]">{m.noPlanDesc}</p>
      </div>
    );
  }

  const plan = detail.data;
  const completed = plan.tasks.filter((task) => task.completed).length;
  const progress = plan.tasks.length > 0 ? Math.round((completed / plan.tasks.length) * 100) : 0;

  return (
    <>
      <MyPlanSummary
        jobTitle={ownPlan.user.jobTitle}
        startDate={plan.startDate}
        status={plan.status}
        phase={plan.phase}
        progress={progress}
        buddy={plan.buddy}
      />
      <MyTaskList
        tasks={plan.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          responsible: task.responsible,
          dueDate: task.dueDate,
          completed: task.completed,
        }))}
      />
      <MyCheckInList
        checkIns={plan.checkIns.map((checkIn) => ({
          id: checkIn.id,
          type: checkIn.type,
          scheduledDate: checkIn.scheduledDate,
          status: checkIn.status,
        }))}
      />
    </>
  );
}
