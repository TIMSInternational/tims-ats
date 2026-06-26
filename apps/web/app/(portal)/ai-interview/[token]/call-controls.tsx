'use client';

import { useI18n } from '../../../../lib/i18n';

interface CallControlsProps {
  micMuted: boolean;
  onToggleMute: () => void;
  view: 'call' | 'focus';
  onToggleView: () => void;
  onEnd: () => void;
}

export function CallControls({ micMuted, onToggleMute, view, onToggleView, onEnd }: CallControlsProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={micMuted ? t.aiInterview.unmuteMic : t.aiInterview.muteMic}
        className="w-12 h-12 rounded-full bg-[#2a2148] text-white text-lg hover:bg-[#352a59] transition"
      >
        {micMuted ? '🔇' : '🎙'}
      </button>
      <button
        type="button"
        onClick={onToggleView}
        className="h-10 px-4 rounded-full bg-[#241a3d] text-[#cfc8ea] text-xs border border-[#3a2d63] hover:bg-[#2d2150] transition"
      >
        {view === 'call' ? t.aiInterview.focusView : t.aiInterview.callView}
      </button>
      <button
        type="button"
        onClick={onEnd}
        aria-label={t.aiInterview.endInterview}
        className="w-12 h-12 rounded-full bg-[#DD0C15] text-white text-lg hover:bg-[#b50a11] transition"
      >
        ✕
      </button>
    </div>
  );
}
