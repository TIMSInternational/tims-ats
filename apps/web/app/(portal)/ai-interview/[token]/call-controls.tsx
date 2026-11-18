'use client';

import { useI18n } from '../../../../lib/i18n';

interface CallControlsProps {
  micMuted: boolean;
  onToggleMute: () => void;
  view: 'call' | 'focus';
  onToggleView: () => void;
  /** Asks first: the call shell confirms before ending a single-use interview. */
  onEnd: () => void;
}

const CONTROL = 'flex size-12 items-center justify-center rounded-full transition-colors';
const CAPTION = 'text-caption text-[#cfc8ea]';

// Three labelled controls: each has a visible caption under its icon, so none relies on a glyph alone.
export function CallControls({ micMuted, onToggleMute, view, onToggleView, onEnd }: CallControlsProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-start justify-center gap-6">
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onToggleMute}
          aria-pressed={micMuted}
          aria-label={t.aiInterview.muteMic}
          className={`${CONTROL} ${micMuted ? 'bg-white text-brand' : 'bg-[#2a2148] text-white hover:bg-[#352a59]'}`}
        >
          <svg className="size-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
            {micMuted && <path d="M3 3l18 18" strokeLinecap="round" />}
          </svg>
        </button>
        <span className={CAPTION} aria-hidden="true">
          {micMuted ? t.aiInterview.unmuteShort : t.aiInterview.muteShort}
        </span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onToggleView}
          className="flex h-12 items-center rounded-full border border-[#3a2d63] bg-[#241a3d] px-4 text-callout text-[#cfc8ea] transition-colors hover:bg-[#2d2150]"
        >
          {view === 'call' ? t.aiInterview.focusView : t.aiInterview.callView}
        </button>
      </div>
      <div className="flex flex-col items-center gap-1">
        <button
          type="button"
          onClick={onEnd}
          aria-label={t.aiInterview.endInterview}
          className={`${CONTROL} bg-brand-red text-white hover:bg-brand-red-hover`}
        >
          {/* Phone-down: "end the call", not the "close this" of an ✕. */}
          <svg className="size-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.996.996 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
          </svg>
        </button>
        <span className={CAPTION} aria-hidden="true">
          {t.aiInterview.endShort}
        </span>
      </div>
    </div>
  );
}
