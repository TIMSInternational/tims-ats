'use client';

import { useI18n } from '../lib/i18n';

/**
 * Short, always-visible human-in-the-loop label shown next to AI-generated
 * screening results and fit scores: the score is a suggestion and the
 * recruiter makes the decision.
 */
export function AiSuggestionNotice({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p
      data-testid="ai-suggestion-notice"
      className={`flex items-center gap-1.5 text-[11px] text-muted ${className}`}
    >
      <svg aria-hidden="true" className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
      </svg>
      <span>{t.common.aiSuggestionNotice}</span>
    </p>
  );
}
