'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { ErrorState } from '../../../../components';
import { LogCoachingModal } from './log-coaching-modal';
import { CreateCommitmentModal } from './create-commitment-modal';

interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

export interface CoachingSessionItem {
  id: string;
  scheduledAt: string | Date;
  topic: string;
  status: string;
  employee: SessionUser | null;
  leader: SessionUser | null;
}

export interface CommitmentItem {
  id: string;
  description: string;
  status: string;
  dueDate: string | Date;
  completedAt?: string | Date | null;
  employee: { id: string; firstName: string; lastName: string; avatar: string | null } | null;
  creator: { id: string; firstName: string; lastName: string } | null;
}

const PRIORITY_BADGE: Record<string, { cls: string; labelKey: 'urgent' | 'pending' | 'scheduled' }> = {
  urgent: { cls: 'bg-red-50 text-red-600', labelKey: 'urgent' },
  pending: { cls: 'bg-amber-50 text-amber-600', labelKey: 'pending' },
  scheduled: { cls: 'bg-green-50 text-green-600', labelKey: 'scheduled' },
};

const STATUS_BADGE: Record<string, { cls: string; labelKey: 'commitmentExpired' | 'commitmentInProgress' | 'commitmentCompleted' }> = {
  expired: { cls: 'bg-red-50 text-red-600', labelKey: 'commitmentExpired' },
  pending: { cls: 'bg-red-50 text-red-600', labelKey: 'commitmentExpired' },
  in_progress: { cls: 'bg-amber-50 text-amber-600', labelKey: 'commitmentInProgress' },
  completed: { cls: 'bg-green-50 text-green-600', labelKey: 'commitmentCompleted' },
};

function formatDate(d: string | Date): string {
  const date = new Date(d);
  return date.toLocaleDateString('es-CO', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatShortDate(d: string | Date): string {
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getCommitmentStatus(status: string, dueDate: string | Date): string {
  if (status === 'completed') return 'completed';
  const due = new Date(dueDate);
  if (due < new Date()) return 'expired';
  if (status === 'in_progress') return 'in_progress';
  return 'pending';
}

function getPriority(status: string): string {
  if (status === 'urgent') return 'urgent';
  if (status === 'pending') return 'pending';
  return 'scheduled';
}

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-[#EDEDED]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-5 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-200 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-2.5 w-48 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="h-5 w-16 bg-gray-200 rounded-full animate-pulse" />
        </div>
      ))}
    </div>
  );
}

interface CoachingPanelProps {
  sessions: CoachingSessionItem[];
  commitments: CommitmentItem[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function CoachingPanel({ sessions, commitments, isLoading, isError, onRetry }: CoachingPanelProps) {
  const { t } = useI18n();
  const [showCoach, setShowCoach] = useState(false);
  const [showCommit, setShowCommit] = useState(false);

  return (
    <div className="grid grid-cols-[1fr_480px] gap-4">
      {/* Coaching Sessions */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.coachingTitle}</h3>
          <button
            type="button"
            onClick={() => setShowCoach(true)}
            className="text-[10px] bg-[#DD0C15] text-white rounded-md px-2.5 py-1 font-medium hover:bg-red-700 transition"
          >
            {t.performance.logCoachingAction}
          </button>
        </div>
        {isLoading ? (
          <SkeletonRows count={4} />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : sessions.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#8B8B8B]">
            {t.performance.noSessionsScheduled}
          </div>
        ) : (
          <div className="divide-y divide-[#EDEDED]">
            {sessions.map((s) => {
              const priority = getPriority(s.status);
              const badge = PRIORITY_BADGE[priority];
              const coachName = s.leader ? `${s.leader.firstName} ${s.leader.lastName}` : 'N/A';
              const coacheeName = s.employee ? `${s.employee.firstName} ${s.employee.lastName}` : 'N/A';
              return (
                <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <CalendarIcon />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[#333]">{formatDate(s.scheduledAt)}</div>
                    <div className="text-[11px] text-[#585858]">
                      {coachName} &rarr; {coacheeName}
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
        )}
      </div>

      {/* Commitments */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.commitmentsTitle}</h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowCommit(true)}
              className="text-[10px] bg-[#DD0C15] text-white rounded-md px-2.5 py-1 font-medium hover:bg-red-700 transition"
            >
              {t.performance.newCommitment}
            </button>
            <button onClick={() => toast(t.performance.viewAllComingSoon, { type: 'info' })} className="text-[10px] text-[#DD0C15] font-medium hover:underline">
              {t.performance.viewAll}
            </button>
          </div>
        </div>
        {isLoading ? (
          <SkeletonRows count={4} />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : commitments.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#8B8B8B]">
            {t.performance.noCommitmentsRegistered}
          </div>
        ) : (
          <div className="divide-y divide-[#EDEDED]">
            {commitments.map((c) => {
              const resolvedStatus = getCommitmentStatus(c.status, c.dueDate);
              const badge = STATUS_BADGE[resolvedStatus] ?? STATUS_BADGE['in_progress'];
              const dateLabel = resolvedStatus === 'completed' ? t.performance.completed : t.performance.deadline;
              const employeeName = c.employee ? `${c.employee.firstName} ${c.employee.lastName}` : 'N/A';
              const leaderName = c.creator ? `${c.creator.firstName} ${c.creator.lastName}` : 'N/A';
              return (
                <div key={c.id} className="px-5 py-2.5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-medium text-[#333]">
                      {employeeName} &mdash; {c.description}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                      {t.performance[badge.labelKey]}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#8B8B8B]">
                    {dateLabel}: {formatShortDate(c.dueDate)} &middot; {t.performance.leader}: {leaderName}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {showCoach && <LogCoachingModal onClose={() => setShowCoach(false)} />}
      {showCommit && <CreateCommitmentModal onClose={() => setShowCommit(false)} />}
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
