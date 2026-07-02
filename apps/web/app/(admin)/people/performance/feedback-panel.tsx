'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';
import { RecognitionModal } from './recognition-modal';
import { FeedbackModal } from './feedback-modal';

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

const FEEDBACK_TYPE: Record<string, { cls: string; labelKey: 'typeConstructive' | 'typeImprovement' | 'typePositive' }> = {
  constructive: { cls: 'bg-blue-50 text-blue-600', labelKey: 'typeConstructive' },
  improvement: { cls: 'bg-amber-50 text-amber-600', labelKey: 'typeImprovement' },
  positive: { cls: 'bg-green-50 text-green-600', labelKey: 'typePositive' },
};

const CATEGORY_EMOJI: Record<string, { emoji: string; bg: string }> = {
  excellence: { emoji: '\u2B50', bg: 'bg-yellow-50' },
  top_performer: { emoji: '\uD83D\uDCAA', bg: 'bg-blue-50' },
  teamwork: { emoji: '\uD83E\uDD1D', bg: 'bg-green-50' },
  innovation: { emoji: '\uD83D\uDCA1', bg: 'bg-purple-50' },
  leadership: { emoji: '\uD83C\uDFC6', bg: 'bg-amber-50' },
};

const CATEGORY_BADGE: Record<string, { labelKey: string; cls: string }> = {
  excellence: { labelKey: 'badgeExcellence', cls: 'bg-yellow-50 text-yellow-700' },
  top_performer: { labelKey: 'badgeTopPerformer', cls: 'bg-blue-50 text-blue-700' },
  teamwork: { labelKey: 'badgeTeamwork', cls: 'bg-green-50 text-green-700' },
  innovation: { labelKey: 'badgeInnovation', cls: 'bg-purple-50 text-purple-700' },
  leadership: { labelKey: 'badgeLeadership', cls: 'bg-amber-50 text-amber-700' },
};

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const AVATAR_COLORS = [
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-blue-100', text: 'text-blue-700' },
  { bg: 'bg-orange-100', text: 'text-orange-700' },
  { bg: 'bg-purple-100', text: 'text-purple-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { bg: 'bg-pink-100', text: 'text-pink-700' },
];

function getAvatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

function timeAgo(d: string | Date): string {
  const diffMs = Date.now() - new Date(d).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `Hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `Hace ${diffHr} hora${diffHr > 1 ? 's' : ''}`;
  const diffDay = Math.floor(diffHr / 24);
  return `Hace ${diffDay} dia${diffDay > 1 ? 's' : ''}`;
}

function SkeletonList({ count }: { count: number }) {
  return (
    <div className="divide-y divide-[#EDEDED]">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="px-5 py-3 flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-gray-200 animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-40 bg-gray-200 rounded animate-pulse" />
            <div className="h-2.5 w-full bg-gray-200 rounded animate-pulse" />
            <div className="h-2 w-16 bg-gray-200 rounded animate-pulse" />
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
  onRetry?: () => void;
}

export function FeedbackPanel({ feedbacks, recognitions, isLoading, isError, onRetry }: FeedbackPanelProps) {
  const { t } = useI18n();
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showRecognitionModal, setShowRecognitionModal] = useState(false);

  return (
    <div className="grid grid-cols-2 gap-4">
      {showFeedbackModal && <FeedbackModal onClose={() => setShowFeedbackModal(false)} />}
      {showRecognitionModal && <RecognitionModal onClose={() => setShowRecognitionModal(false)} />}

      {/* Continuous Feedback */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.feedbackTitle}</h3>
          <button onClick={() => setShowFeedbackModal(true)} className="text-[10px] text-[#DD0C15] font-medium hover:underline">
            {t.performance.giveFeedback}
          </button>
        </div>
        {isLoading ? (
          <SkeletonList count={3} />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : feedbacks.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#8B8B8B]">
            No hay feedback registrado
          </div>
        ) : (
          <div className="divide-y divide-[#EDEDED]">
            {feedbacks.map((fb) => {
              const typeBadge = FEEDBACK_TYPE[fb.type] ?? FEEDBACK_TYPE['constructive'];
              const fromName = fb.isAnonymous || !fb.fromUser
                ? 'Anonimo' : `${fb.fromUser.firstName} ${fb.fromUser.lastName}`;
              const toName = fb.toUser ? `${fb.toUser.firstName} ${fb.toUser.lastName}` : 'N/A';
              const initials = fb.isAnonymous || !fb.fromUser
                ? '??' : getInitials(fb.fromUser.firstName, fb.fromUser.lastName);
              const color = fb.fromUser ? getAvatarColor(fb.fromUser.id) : AVATAR_COLORS[0];
              return (
                <div key={fb.id} className="px-5 py-3 flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full ${color.bg} ${color.text} flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-medium text-[#333]">{fromName}</span>
                      <ArrowIcon />
                      <span className="text-[11px] text-[#585858]">{toName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeBadge.cls}`}>
                        {t.performance[typeBadge.labelKey]}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#585858] line-clamp-1">{fb.message}</p>
                    <span className="text-[10px] text-[#8B8B8B]">{timeAgo(fb.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recognition Wall */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <h3 className="text-[13px] font-semibold text-[#333]">{t.performance.recognitionTitle}</h3>
          <button onClick={() => setShowRecognitionModal(true)} className="text-[10px] text-[#DD0C15] font-medium hover:underline">
            {t.performance.recognize}
          </button>
        </div>
        {isLoading ? (
          <SkeletonList count={3} />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : recognitions.length === 0 ? (
          <div className="px-5 py-8 text-center text-[12px] text-[#8B8B8B]">
            No hay reconocimientos registrados
          </div>
        ) : (
          <div className="divide-y divide-[#EDEDED]">
            {recognitions.map((r) => {
              const emojiData = CATEGORY_EMOJI[r.category] ?? { emoji: '\u2B50', bg: 'bg-yellow-50' };
              const badgeData = CATEGORY_BADGE[r.category] ?? { labelKey: 'badgeExcellence', cls: 'bg-yellow-50 text-yellow-700' };
              const toName = r.toUser ? `${r.toUser.firstName} ${r.toUser.lastName}` : 'N/A';
              const fromName = r.fromUser ? `Por ${r.fromUser.firstName} ${r.fromUser.lastName}` : '';
              return (
                <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-lg ${emojiData.bg} flex items-center justify-center text-[16px] shrink-0`}>
                    {emojiData.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-[11px] font-medium text-[#333]">{toName}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badgeData.cls}`}>
                        {t.performance[badgeData.labelKey as keyof typeof t.performance]}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#585858]">{r.message}</p>
                    <span className="text-[10px] text-[#8B8B8B]">{fromName} &middot; {timeAgo(r.createdAt)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ArrowIcon() {
  return (
    <svg className="w-3 h-3 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
    </svg>
  );
}
