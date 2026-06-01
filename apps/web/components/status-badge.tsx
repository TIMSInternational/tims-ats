'use client';

interface StatusBadgeProps {
  status: string;
  map: Record<string, { cls: string; label: string }>;
}

export function StatusBadge({ status, map }: StatusBadgeProps) {
  const entry = map[status?.toLowerCase()] || {
    cls: 'bg-gray-100 text-gray-600',
    label: status,
  };

  return (
    <span
      className={`px-2 py-1 rounded-full text-[10px] font-bold ${entry.cls}`}
    >
      {entry.label}
    </span>
  );
}
