'use client';

import { useI18n } from '../../../../lib/i18n';

interface AiOrbProps {
  state: 'speaking' | 'listening' | 'connecting';
  size?: 'sm' | 'lg';
}

export function AiOrb({ state, size = 'lg' }: AiOrbProps) {
  const { t } = useI18n();
  const diameter = size === 'lg' ? 'w-28 h-28' : 'w-16 h-16';
  const label =
    state === 'speaking'
      ? t.aiInterview.aiSpeaking
      : state === 'listening'
        ? t.aiInterview.aiListening
        : t.aiInterview.connecting;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        {state === 'speaking' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#7c5cff]/30 animate-ping" />
        )}
        <span
          className={`relative ${diameter} rounded-full bg-[radial-gradient(circle_at_35%_30%,#7c5cff,#2a1866)] shadow-[0_0_0_8px_rgba(124,92,255,0.16)] transition-opacity ${
            state === 'listening' ? 'opacity-60' : 'opacity-100'
          } ${state === 'connecting' ? 'animate-pulse' : ''}`}
        />
      </div>
      <p className="text-xs text-[#b9b0e0]">
        {t.aiInterview.interviewer} · {label}
      </p>
    </div>
  );
}
