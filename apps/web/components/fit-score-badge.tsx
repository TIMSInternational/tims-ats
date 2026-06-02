'use client';

interface FitScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: 'w-7 h-7 text-[9px]',
  md: 'w-9 h-9 text-[11px]',
  lg: 'w-12 h-12 text-[14px]',
};

function getColor(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-700 border-emerald-300';
  if (score >= 40) return 'bg-amber-100 text-amber-700 border-amber-300';
  return 'bg-red-100 text-red-700 border-red-300';
}

export function FitScoreBadge({ score, size = 'md' }: FitScoreBadgeProps) {
  return (
    <div
      className={`${SIZES[size]} rounded-full border flex items-center justify-center font-bold shrink-0 ${getColor(score)}`}
      title={`FIT Score: ${score}`}
    >
      {score}
    </div>
  );
}
