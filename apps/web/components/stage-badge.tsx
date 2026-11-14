'use client';

interface StageBadgeProps {
  name: string;
  order?: number;
}

// -700 text on -100 fills: every pair passes 4.5:1 at 11px.
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

/** A pipeline stage chip: a dot in the stage colour plus the stage name. */
export function StageBadge({ name, order = 0 }: StageBadgeProps) {
  const color = STAGE_COLORS[order % STAGE_COLORS.length];
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-caption font-medium ${color}`}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
      {name}
    </span>
  );
}
