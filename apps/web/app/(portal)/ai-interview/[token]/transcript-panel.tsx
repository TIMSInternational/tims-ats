'use client';

import { useI18n } from '../../../../lib/i18n';
import type { TranscriptState } from './transcript';

interface TranscriptPanelProps {
  transcript: TranscriptState;
  variant: 'panel' | 'focus';
}

export function TranscriptPanel({ transcript, variant }: TranscriptPanelProps) {
  const { t } = useI18n();
  const container =
    variant === 'focus'
      ? 'w-full max-w-2xl mx-auto flex flex-col gap-2'
      : 'flex-1 min-h-0 overflow-y-auto rounded-xl bg-[#161226] p-3 flex flex-col gap-2';
  const lastIndex = transcript.entries.length - 1;

  return (
    <div className={container}>
      {variant === 'panel' && (
        <p className="text-caption font-medium text-[#cfc8ea]">
          {t.aiInterview.liveTranscript}
        </p>
      )}
      {transcript.entries.map((entry, i) => {
        const who = entry.role === 'ai' ? t.aiInterview.interviewer : t.aiInterview.you;
        const live = i === lastIndex && !entry.final;
        const bubble =
          entry.role === 'ai'
            ? 'bg-[#221a3d] text-[#e9e6f5]'
            : 'bg-[#1c1733] text-[#9a91c4] self-end';
        return (
          <p key={entry.id} className={`rounded-lg px-3 py-2 text-base sm:text-subheading ${bubble}`}>
            <span className="font-medium">{who}: </span>
            {entry.text}
            {live && <span className="opacity-50" aria-hidden="true">▍</span>}
          </p>
        );
      })}
    </div>
  );
}
