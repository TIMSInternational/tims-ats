'use client';

import type { ExpiringTrial } from '../../../../lib/trpc-types';

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function daysUntil(date: string | Date): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function getInitials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

const avatarColors = [
  'bg-[#1F114C]', 'bg-blue-500', 'bg-violet-500', 'bg-amber-500',
  'bg-rose-500', 'bg-teal-500', 'bg-cyan-500', 'bg-emerald-600',
  'bg-indigo-500', 'bg-orange-500', 'bg-pink-500', 'bg-gray-400',
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

export function TrialsAlert({
  trials,
  onExtendTrial,
  isUpdating,
}: {
  trials: ExpiringTrial[];
  onExtendTrial: (organizationId: string) => void;
  isUpdating: boolean;
}) {
  if (trials.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 border border-amber-200 mt-5 flex-shrink-0">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01" /></svg>
        <h3 className="text-sm font-semibold text-[#333]">Trials por Vencer -- Proximos 7 dias</h3>
      </div>
      <div className="space-y-3">
        {trials.map((trial) => {
          const days = trial.trialEndsAt ? daysUntil(trial.trialEndsAt) : 0;
          const orgName = trial.organization?.name || 'Organizacion';
          return (
            <div key={trial.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50">
              <div className="flex items-center gap-3">
                <div className={`w-8 h-8 rounded-md ${getAvatarColor(orgName)} flex items-center justify-center text-white text-[10px] font-bold`}>
                  {getInitials(orgName)}
                </div>
                <div>
                  <p className="text-sm text-[#333] font-medium">{orgName}</p>
                  <p className="text-[10px] text-[#8B8B8B]">{trial.organization?.slug}</p>
                </div>
              </div>
              <div className="text-right">
                <p className={`text-xs font-bold ${days <= 3 ? 'text-[#DD0C15]' : 'text-amber-600'}`}>
                  Vence {formatDate(trial.trialEndsAt)}
                </p>
                <p className="text-[10px] text-[#8B8B8B]">{days} dias restantes</p>
              </div>
              <div className="flex items-center gap-2">
                <button className="h-7 px-3 rounded-md bg-[#1F114C] text-white text-[10px] font-medium hover:bg-[#2a1866] transition">Contactar</button>
                <button
                  onClick={() => onExtendTrial(trial.organizationId)}
                  disabled={isUpdating}
                  className="h-7 px-3 rounded-md border border-[#EDEDED] text-[10px] font-medium text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50"
                >
                  Extender
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
