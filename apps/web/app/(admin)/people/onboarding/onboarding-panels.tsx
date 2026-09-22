'use client';

import type { OnboardingPlan } from './onboarding-table';
import { useI18n } from '../../../../lib/i18n';

function DocIcon({ urgent }: { urgent: boolean }) {
  return (
    <svg
      className={`w-4 h-4 ${urgent ? 'text-[#DD0C15]' : 'text-amber-500'}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  );
}

export function TasksByResponsible({ plans }: { plans: OnboardingPlan[] }) {
  const { t } = useI18n();
  const allTasks = plans.flatMap((p) => p.tasks);
  const byRole: Record<string, { total: number; done: number }> = {};
  for (const t of allTasks) {
    const role = t.responsible || 'Otro';
    if (!byRole[role]) byRole[role] = { total: 0, done: 0 };
    byRole[role].total++;
    if (t.completed) byRole[role].done++;
  }

  const ROLE_COLORS: Record<string, { bar: string; dot: string }> = {
    RRHH: { bar: 'bg-[#1F114C]', dot: 'bg-[#1F114C]' },
    Lider: { bar: 'bg-[#5C4B99]', dot: 'bg-[#5C4B99]' },
    IT: { bar: 'bg-blue-500', dot: 'bg-blue-500' },
    Buddy: { bar: 'bg-green-500', dot: 'bg-green-500' },
    Empleado: { bar: 'bg-amber-500', dot: 'bg-amber-500' },
  };

  const roles = Object.entries(byRole).sort((a, b) => b[1].total - a[1].total);
  const lowestRole =
    roles.length > 0
      ? roles.reduce((min, r) =>
          r[1].total > 0 && r[1].done / r[1].total < (min[1].total > 0 ? min[1].done / min[1].total : 1) ? r : min,
        )
      : null;

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.onboarding.tasksByResponsible}</h3>
      <div className="space-y-3">
        {roles.map(([role, { total, done }]) => {
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const colors = ROLE_COLORS[role] ?? { bar: 'bg-gray-500', dot: 'bg-gray-500' };
          return (
            <div key={role}>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[12px] text-[#333] font-medium flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                  {role}
                </span>
                <span className={`text-[11px] font-medium ${pct < 50 ? 'text-[#DD0C15]' : 'text-[#1F114C]'}`}>
                  {done}/{total} completadas
                </span>
              </div>
              <div className="w-full bg-[#F6F6F6] rounded-full h-2.5">
                <div className={`h-2.5 ${colors.bar} rounded-full`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
        {roles.length === 0 && <p className="text-[11px] text-[#8B8B8B]">{t.onboarding.noTasksRegistered}</p>}
      </div>
      {lowestRole && lowestRole[1].total > 0 && (
        <p className="text-[10px] text-[#DD0C15] mt-3 pt-3 border-t border-[#F0F0F0] font-medium">
          Alerta: {lowestRole[0]} tiene el menor avance ({Math.round((lowestRole[1].done / lowestRole[1].total) * 100)}
          %).
        </p>
      )}
    </div>
  );
}

export function PendingTasks({ plans }: { plans: OnboardingPlan[] }) {
  const { t } = useI18n();
  const incompleteTasks = plans
    .flatMap((p) =>
      p.tasks
        .filter((t) => !t.completed)
        .map((t) => ({
          id: t.id,
          name: t.title,
          responsible: t.responsible,
          person: `${p.user.firstName} ${p.user.lastName}`,
          urgent: (p.riskScore ?? 0) > 0.3,
        })),
    )
    .slice(0, 5);

  const totalPending = plans.reduce((s, p) => s + p.tasks.filter((t) => !t.completed).length, 0);

  return (
    <div className="w-full md:flex-1 bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.onboarding.pendingTasks}</h3>
        <span className="bg-amber-500 text-white text-[10px] font-bold w-6 h-6 rounded-full flex items-center justify-center">
          {totalPending}
        </span>
      </div>
      <div className="space-y-2">
        {incompleteTasks.length === 0 && <p className="text-[11px] text-[#8B8B8B]">{t.onboarding.noPendingTasks}</p>}
        {incompleteTasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between bg-[#F6F6F6] rounded-lg px-3 py-2.5">
            <div className="flex items-center gap-2">
              <DocIcon urgent={task.urgent} />
              <div>
                <p className="text-[11px] text-[#333] font-medium">{task.name}</p>
                <p className="text-[10px] text-[#8B8B8B]">
                  {task.person} — {task.responsible}
                </p>
              </div>
            </div>
          </div>
        ))}
        {totalPending > 5 && <p className="text-[10px] text-[#585858]">+{totalPending - 5} tareas mas pendientes</p>}
      </div>
    </div>
  );
}
