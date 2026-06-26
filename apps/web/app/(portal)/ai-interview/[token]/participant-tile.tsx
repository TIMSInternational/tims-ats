'use client';

interface ParticipantTileProps {
  name: string;
  level: number; // 0..1 mic input level
  muted: boolean;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function ParticipantTile({ name, level, muted }: ParticipantTileProps) {
  // Map 0..1 level to a 0..100 width class via inline-free Tailwind: use a scaleX transform class set.
  const bars = [0.15, 0.35, 0.55, 0.75, 0.95];
  return (
    <div className="flex-1 rounded-xl bg-[#241a3d] flex flex-col items-center justify-center gap-3 p-4">
      <div className="w-14 h-14 rounded-full bg-[#3a2d63] flex items-center justify-center text-sm text-[#cfc8ea]">
        {initials(name)}
      </div>
      <div className="flex items-end gap-1 h-5" aria-hidden>
        {bars.map((threshold) => (
          <span
            key={threshold}
            className={`w-1.5 rounded-sm transition-all ${
              !muted && level >= threshold ? 'h-5 bg-[#7c5cff]' : 'h-1.5 bg-[#3a2d63]'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-[#8a83ad]">
        {name}
        {muted ? ' · 🔇' : ''}
      </p>
    </div>
  );
}
