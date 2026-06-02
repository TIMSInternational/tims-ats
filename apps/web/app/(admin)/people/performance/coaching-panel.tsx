'use client';

import { useI18n } from '../../../../lib/i18n';

interface CoachingSession {
  id: string;
  date: string;
  coach: string;
  coachee: string;
  topic: string;
  priority: 'urgent' | 'pending' | 'scheduled';
}

interface Commitment {
  id: string;
  employee: string;
  description: string;
  status: 'expired' | 'in_progress' | 'completed';
  date: string;
  leader: string;
}

const MOCK_SESSIONS: CoachingSession[] = [
  { id: '1', date: 'Lun 02 Jun, 10:00 AM', coach: 'Roberto Diaz', coachee: 'Jorge Torres', topic: 'Revision avance tracking + plan de accion', priority: 'urgent' },
  { id: '2', date: 'Mar 03 Jun, 2:00 PM', coach: 'Ana Morales', coachee: 'Diego Villamizar', topic: 'Coaching desempeno: meta merma 2%', priority: 'urgent' },
  { id: '3', date: 'Mie 04 Jun, 9:30 AM', coach: 'Carlos Ramirez', coachee: 'Maria Fernandez', topic: 'Seguimiento optimizacion de rutas', priority: 'pending' },
  { id: '4', date: 'Vie 06 Jun, 11:00 AM', coach: 'Roberto Diaz', coachee: 'Andrea Gutierrez', topic: 'Celebracion: cuentas Q2 casi completas', priority: 'scheduled' },
];

const MOCK_COMMITMENTS: Commitment[] = [
  { id: '1', employee: 'Jorge Torres', description: 'Plan de accion tracking', status: 'expired', date: '25 May 2026', leader: 'Roberto Diaz' },
  { id: '2', employee: 'Diego Villamizar', description: 'Auditoria proceso merma', status: 'expired', date: '27 May 2026', leader: 'Ana Morales' },
  { id: '3', employee: 'Maria Fernandez', description: 'Presentar 3 rutas alternas', status: 'in_progress', date: '05 Jun 2026', leader: 'Carlos Ramirez' },
  { id: '4', employee: 'Ricardo Mendoza', description: 'Propuesta upselling clientes A', status: 'completed', date: '28 May 2026', leader: 'Roberto Diaz' },
  { id: '5', employee: 'Laura Paredes', description: 'Documentacion ISO fase 3', status: 'in_progress', date: '10 Jun 2026', leader: 'Ana Morales' },
];

const PRIORITY_BADGE: Record<string, { cls: string; labelKey: 'urgent' | 'pending' | 'scheduled' }> = {
  urgent: { cls: 'bg-red-50 text-red-600', labelKey: 'urgent' },
  pending: { cls: 'bg-amber-50 text-amber-600', labelKey: 'pending' },
  scheduled: { cls: 'bg-green-50 text-green-600', labelKey: 'scheduled' },
};

const STATUS_BADGE: Record<string, { cls: string; labelKey: 'commitmentExpired' | 'commitmentInProgress' | 'commitmentCompleted' }> = {
  expired: { cls: 'bg-red-50 text-red-600', labelKey: 'commitmentExpired' },
  in_progress: { cls: 'bg-amber-50 text-amber-600', labelKey: 'commitmentInProgress' },
  completed: { cls: 'bg-green-50 text-green-600', labelKey: 'commitmentCompleted' },
};

export function CoachingPanel() {
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-[1fr_480px] gap-4">
      {/* Coaching Sessions */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.coachingTitle}</h3>
          <span className="text-[10px] text-[#8B8B8B]">{t.performance.next7Days}</span>
        </div>
        <div className="divide-y divide-[#EDEDED]">
          {MOCK_SESSIONS.map((s) => {
            const badge = PRIORITY_BADGE[s.priority];
            return (
              <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <CalendarIcon />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium text-[#333]">{s.date}</div>
                  <div className="text-[11px] text-[#585858]">
                    {s.coach} &rarr; {s.coachee}
                  </div>
                  <div className="text-[10px] text-[#8B8B8B]">{s.topic}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 ${badge.cls}`}>
                  {t.performance[badge.labelKey]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Commitments */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.commitmentsTitle}</h3>
          <button className="text-[10px] text-[#DD0C15] font-medium hover:underline">
            {t.performance.viewAll}
          </button>
        </div>
        <div className="divide-y divide-[#EDEDED]">
          {MOCK_COMMITMENTS.map((c) => {
            const badge = STATUS_BADGE[c.status];
            const dateLabel = c.status === 'completed' ? t.performance.completed : t.performance.deadline;
            return (
              <div key={c.id} className="px-5 py-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-medium text-[#333]">
                    {c.employee} &mdash; {c.description}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                    {t.performance[badge.labelKey]}
                  </span>
                </div>
                <div className="text-[10px] text-[#8B8B8B]">
                  {dateLabel}: {c.date} &middot; {t.performance.leader}: {c.leader}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
      <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25" />
      <path d="M3 10.5h18" />
    </svg>
  );
}
