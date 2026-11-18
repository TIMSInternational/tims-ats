'use client';

import { useI18n } from '../../../../lib/i18n';

interface ParticipantTileProps {
  name: string;
  level: number; // 0..1 mic input level
  muted: boolean;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function ParticipantTile({ name, level, muted }: ParticipantTileProps) {
  const { t } = useI18n();
  const mutedLabel = t.aiInterview.mutedState;
  // Map 0..1 level to a 0..100 width class via inline-free Tailwind: use a scaleX transform class set.
  const bars = [0.15, 0.35, 0.55, 0.75, 0.95];
  return (
    <div className="flex-1 rounded-xl bg-[#241a3d] flex flex-col items-center justify-center gap-3 p-4">
      <div className="flex size-14 items-center justify-center rounded-full bg-[#3a2d63] text-subheading text-[#cfc8ea]" aria-hidden="true">
        {initials(name)}
      </div>
      <div className="flex h-5 items-end gap-1" aria-hidden="true">
        {bars.map((threshold) => (
          <span
            key={threshold}
            className={`w-1.5 rounded-sm transition-[height] duration-100 motion-reduce:transition-none ${
              !muted && level >= threshold ? 'h-5 bg-white' : 'h-1.5 bg-[#3a2d63]'
            }`}
          />
        ))}
      </div>
      <p className="text-callout text-[#cfc8ea]">
        {name}
        {muted && <span> · {mutedLabel}</span>}
      </p>
    </div>
  );
}
