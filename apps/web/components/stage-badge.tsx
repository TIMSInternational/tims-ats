'use client';

interface StageBadgeProps {
  name: string;
  order?: number;
}

const STAGE_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-indigo-100 text-indigo-700',
  'bg-purple-100 text-purple-700',
  'bg-fuchsia-100 text-fuchsia-700',
  'bg-emerald-100 text-emerald-700',
  'bg-teal-100 text-teal-700',
  'bg-cyan-100 text-cyan-700',
];

export function StageBadge({ name, order = 0 }: StageBadgeProps) {
  const color = STAGE_COLORS[order % STAGE_COLORS.length];
  return (
    <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${color}`}>
      {name}
    </span>
  );
}
