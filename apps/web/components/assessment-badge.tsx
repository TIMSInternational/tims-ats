'use client';

interface AssessmentBadgeProps {
  type: string;
  status: string;
}

const TYPE_LABELS: Record<string, string> = {
  PCA: 'PCA',
  MIL: 'MIL',
  integrity: 'INT',
  personality: 'PER',
  IE: 'IE',
};

const STATUS_DOTS: Record<string, string> = {
  pending: 'bg-gray-400',
  in_progress: 'bg-amber-400',
  completed: 'bg-emerald-500',
  expired: 'bg-red-400',
};

export function AssessmentBadge({ type, status }: AssessmentBadgeProps) {
  const label = TYPE_LABELS[type] ?? type.slice(0, 3).toUpperCase();
  const dot = STATUS_DOTS[status] ?? 'bg-gray-400';

  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#F6F6F6] shrink-0" title={`${type}: ${status}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      <span className="text-[9px] font-medium text-[#585858]">{label}</span>
    </div>
  );
}
