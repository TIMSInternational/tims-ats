'use client';

import { useState } from 'react';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../lib/format-utils';
import { Button, CandidateAvatar, EmptyState, ErrorState, Skeleton, StatusBadge } from '../../../../components';
import type { StatusTone } from '../../../../components';
import { RecognitionModal } from './recognition-modal';
import { FeedbackModal } from './feedback-modal';
import { ExpandableMessage } from './expandable-message';

interface FeedbackUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

export interface FeedbackItem {
  id: string;
  type: string;
  message: string;
  createdAt: string | Date;
  isAnonymous: boolean;
  fromUser: FeedbackUser | null;
  toUser: FeedbackUser | null;
}

export interface RecognitionItem {
  id: string;
  category: string;
  message: string;
  createdAt: string | Date;
  fromUser: FeedbackUser | null;
  toUser: FeedbackUser | null;
}

type FeedbackTypeKey = 'typeConstructive' | 'typeImprovement' | 'typePositive';
const FEEDBACK_TYPE: Record<string, { tone: StatusTone; labelKey: FeedbackTypeKey }> = {
  constructive: { tone: 'info', labelKey: 'typeConstructive' },
  improvement: { tone: 'warning', labelKey: 'typeImprovement' },
  positive: { tone: 'success', labelKey: 'typePositive' },
};

// Decorative only (aria-hidden): the category word is in the badge beside it.
const CATEGORY_EMOJI: Record<string, string> = {
  excellence: '⭐',
  top_performer: '💪',
  teamwork: '🤝',
  innovation: '💡',
  leadership: '🏆',
};

type BadgeKey = 'badgeExcellence' | 'badgeTopPerformer' | 'badgeTeamwork' | 'badgeInnovation' | 'badgeLeadership';
const CATEGORY_BADGE: Record<string, BadgeKey> = {
  excellence: 'badgeExcellence',
  top_performer: 'badgeTopPerformer',
  teamwork: 'badgeTeamwork',
  innovation: 'badgeInnovation',
  leadership: 'badgeLeadership',
};

const CARD = 'rounded-xl border border-border bg-white shadow-card';
const CARD_HEADER = 'flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3 md:px-5';

function SkeletonList({ count }: { count: number }) {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3 md:px-5">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface FeedbackPanelProps {
  feedbacks: FeedbackItem[];
  recognitions: RecognitionItem[];
  isLoading: boolean;
  isError?: boolean;
  error?: unknown;
  onRetry?: () => void;
}

export function FeedbackPanel({ feedbacks, recognitions, isLoading, isError, error, onRetry }: FeedbackPanelProps) {
  const { t, locale } = useI18n();
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showRecognitionModal, setShowRecognitionModal] = useState(false);
  const fullName = (u: FeedbackUser | null) => (u ? `${u.firstName} ${u.lastName}` : t.performance.unknownPerson);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {showFeedbackModal && <FeedbackModal onClose={() => setShowFeedbackModal(false)} />}
      {showRecognitionModal && <RecognitionModal onClose={() => setShowRecognitionModal(false)} />}

      {/* Continuous Feedback */}
      <section className={CARD} aria-labelledby="feedback-heading">
        <div className={CARD_HEADER}>
          <h2 id="feedback-heading" className="text-subheading font-semibold text-primary">
            {t.performance.feedbackTitle}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setShowFeedbackModal(true)}>
            {t.performance.giveFeedback}
          </Button>
        </div>
        {isLoading ? (
          <SkeletonList count={3} />
        ) : isError ? (
          <ErrorState size="compact" error={error} onRetry={onRetry} />
        ) : feedbacks.length === 0 ? (
          <EmptyState size="compact" title={t.performance.noFeedback} />
        ) : (
          <ul className="divide-y divide-border">
            {feedbacks.map((fb) => {
              const typeBadge = FEEDBACK_TYPE[fb.type] ?? FEEDBACK_TYPE['constructive'];
              const anonymous = fb.isAnonymous || !fb.fromUser;
              const fromName = anonymous ? t.performance.anonymous : fullName(fb.fromUser);
              return (
                <li key={fb.id} className="flex items-start gap-3 px-4 py-3 md:px-5">
                  {anonymous || !fb.fromUser ? (
                    <span
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface text-caption font-semibold text-secondary"
                      aria-hidden="true"
                    >
                      ?
                    </span>
                  ) : (
                    <CandidateAvatar
                      firstName={fb.fromUser.firstName}
                      lastName={fb.fromUser.lastName}
                      avatar={fb.fromUser.avatar}
                      size="sm"
                      decorative
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-body font-medium text-primary">{fromName}</span>
                      <ArrowIcon />
                      <span className="sr-only">{t.performance.feedbackTo}</span>
                      <span className="text-body text-secondary">{fullName(fb.toUser)}</span>
                      <StatusBadge tone={typeBadge.tone} icon="none">
                        {t.performance[typeBadge.labelKey]}
                      </StatusBadge>
                    </div>
                    <ExpandableMessage text={fb.message} />
                    <span className="text-caption text-muted">{formatRelativeTimeLocale(fb.createdAt, locale)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Recognition Wall */}
      <section className={CARD} aria-labelledby="recognition-heading">
        <div className={CARD_HEADER}>
          <h2 id="recognition-heading" className="text-subheading font-semibold text-primary">
            {t.performance.recognitionTitle}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => setShowRecognitionModal(true)}>
            {t.performance.recognize}
          </Button>
        </div>
        {isLoading ? (
          <SkeletonList count={3} />
        ) : isError ? (
          <ErrorState size="compact" error={error} onRetry={onRetry} />
        ) : recognitions.length === 0 ? (
          <EmptyState size="compact" title={t.performance.noRecognitions} />
        ) : (
          <ul className="divide-y divide-border">
            {recognitions.map((r) => {
              const emoji = CATEGORY_EMOJI[r.category] ?? '⭐';
              const badgeKey = CATEGORY_BADGE[r.category] ?? 'badgeExcellence';
              const when = formatRelativeTimeLocale(r.createdAt, locale);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3 md:px-5">
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-subheading"
                    aria-hidden="true"
                  >
                    {emoji}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-body font-medium text-primary">{fullName(r.toUser)}</span>
                      <StatusBadge tone="brand" icon="none">
                        {t.performance[badgeKey]}
                      </StatusBadge>
                    </div>
                    <ExpandableMessage text={r.message} />
                    <span className="text-caption text-muted">
                      {r.fromUser
                        ? `${formatMessage(t.performance.recognizedBy, { name: fullName(r.fromUser) })} · ${when}`
                        : when}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg
      className="size-3 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}
