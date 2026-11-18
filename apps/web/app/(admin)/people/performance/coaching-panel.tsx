'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { intlLocale } from '../../../../lib/format-utils';
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import type { StatusTone } from '../../../../components';
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

const PRIORITY_BADGE: Record<string, { tone: StatusTone; labelKey: 'urgent' | 'pending' | 'scheduled' }> = {
  urgent: { tone: 'danger', labelKey: 'urgent' },
  pending: { tone: 'warning', labelKey: 'pending' },
  scheduled: { tone: 'info', labelKey: 'scheduled' },
};

type CommitmentLabel = 'commitmentExpired' | 'commitmentInProgress' | 'commitmentCompleted' | 'commitmentPending';
// Only a commitment past its due date reads "Vencido"; one not yet due is neutral "Pendiente".
const STATUS_BADGE: Record<string, { tone: StatusTone; labelKey: CommitmentLabel }> = {
  expired: { tone: 'danger', labelKey: 'commitmentExpired' },
  pending: { tone: 'neutral', labelKey: 'commitmentPending' },
  in_progress: { tone: 'warning', labelKey: 'commitmentInProgress' },
  completed: { tone: 'success', labelKey: 'commitmentCompleted' },
};

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

const CARD = 'min-w-0 rounded-xl border border-border bg-white shadow-card';
const CARD_HEADER = 'flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-5';

function SkeletonRows({ count }: { count: number }) {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 md:px-5">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-48" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
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
  error?: unknown;
  onRetry?: () => void;
  /** Display only: hide "Registrar sesión" / "Nuevo compromiso" from roles that cannot create. */
  canCreate?: boolean;
}

export function CoachingPanel({
  sessions,
  commitments,
  isLoading,
  isError,
  error,
  onRetry,
  canCreate = true,
}: CoachingPanelProps) {
  const { t, locale } = useI18n();
  const [showCoach, setShowCoach] = useState(false);
  const [showCommit, setShowCommit] = useState(false);
  const tag = intlLocale(locale);
  const formatSessionDate = (d: string | Date) =>
    new Date(d).toLocaleDateString(tag, {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  const formatShortDate = (d: string | Date) =>
    new Date(d).toLocaleDateString(tag, { day: '2-digit', month: 'short', year: 'numeric' });
  const nameOf = (u: { firstName: string; lastName: string } | null) =>
    u ? `${u.firstName} ${u.lastName}` : t.performance.unknownPerson;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
      {/* Coaching Sessions */}
      <section className={CARD} aria-labelledby="coaching-heading">
        <div className={CARD_HEADER}>
          <h2 id="coaching-heading" className="text-subheading font-semibold text-primary">
            {t.performance.coachingTitle}
          </h2>
          {canCreate && (
            <Button variant="secondary" size="sm" onClick={() => setShowCoach(true)}>
              {t.performance.logCoachingAction}
            </Button>
          )}
        </div>
        {isLoading ? (
          <SkeletonRows count={4} />
        ) : isError ? (
          <ErrorState size="compact" error={error} onRetry={onRetry} />
        ) : sessions.length === 0 ? (
          <EmptyState size="compact" title={t.performance.noSessionsScheduled} />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((s) => {
              const badge = PRIORITY_BADGE[getPriority(s.status)];
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3 md:px-5">
                  <div
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-tint"
                    aria-hidden="true"
                  >
                    <CalendarIcon />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium text-primary">{formatSessionDate(s.scheduledAt)}</div>
                    <div className="text-callout text-secondary">
                      {nameOf(s.leader)} &rarr; {nameOf(s.employee)}
                    </div>
                    <div className="text-callout text-muted">{s.topic}</div>
                  </div>
                  <StatusBadge tone={badge.tone} className="shrink-0">
                    {t.performance[badge.labelKey]}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Commitments */}
      <section className={CARD} aria-labelledby="commitments-heading">
        <div className={CARD_HEADER}>
          <h2 id="commitments-heading" className="text-subheading font-semibold text-primary">
            {t.performance.commitmentsTitle}
          </h2>
          {canCreate && (
            <Button variant="secondary" size="sm" onClick={() => setShowCommit(true)}>
              {t.performance.newCommitment}
            </Button>
          )}
        </div>
        {isLoading ? (
          <SkeletonRows count={4} />
        ) : isError ? (
          <ErrorState size="compact" error={error} onRetry={onRetry} />
        ) : commitments.length === 0 ? (
          <EmptyState size="compact" title={t.performance.noCommitmentsRegistered} />
        ) : (
          <ul className="divide-y divide-border">
            {commitments.map((c) => {
              const resolvedStatus = getCommitmentStatus(c.status, c.dueDate);
              const badge = STATUS_BADGE[resolvedStatus] ?? STATUS_BADGE['in_progress'];
              const dateLabel = resolvedStatus === 'completed' ? t.performance.completed : t.performance.deadline;
              return (
                <li key={c.id} className="px-4 py-3 md:px-5">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <span className="text-body font-medium text-primary">
                      {nameOf(c.employee)} &mdash; {c.description}
                    </span>
                    <StatusBadge tone={badge.tone} className="shrink-0">
                      {t.performance[badge.labelKey]}
                    </StatusBadge>
                  </div>
                  <div className="text-callout text-secondary">
                    {dateLabel}: <span className="tabular-nums">{formatShortDate(c.dueDate)}</span> &middot;{' '}
                    {t.performance.leader}: {nameOf(c.creator)}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {showCoach && <LogCoachingModal onClose={() => setShowCoach(false)} />}
      {showCommit && <CreateCommitmentModal onClose={() => setShowCommit(false)} />}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      className="size-4 text-brand"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25" />
      <path d="M3 10.5h18" />
    </svg>
  );
}
