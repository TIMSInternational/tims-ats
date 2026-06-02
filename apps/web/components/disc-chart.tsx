'use client';

interface DiscChartProps {
  scores: {
    dominance?: number;
    influence?: number;
    steadiness?: number;
    compliance?: number;
  };
  labels?: {
    dominance?: string;
    influence?: string;
    steadiness?: string;
    compliance?: string;
  };
}

const DEFAULT_LABELS = {
  dominance: 'D',
  influence: 'I',
  steadiness: 'S',
  compliance: 'C',
};

const BAR_COLORS = [
  'bg-[#DD0C15]',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-[#1F114C]',
];

export function DiscChart({ scores, labels }: DiscChartProps) {
  const dims = [
    { key: 'dominance' as const, label: labels?.dominance ?? DEFAULT_LABELS.dominance, value: scores.dominance ?? 0 },
    { key: 'influence' as const, label: labels?.influence ?? DEFAULT_LABELS.influence, value: scores.influence ?? 0 },
    { key: 'steadiness' as const, label: labels?.steadiness ?? DEFAULT_LABELS.steadiness, value: scores.steadiness ?? 0 },
    { key: 'compliance' as const, label: labels?.compliance ?? DEFAULT_LABELS.compliance, value: scores.compliance ?? 0 },
  ];

  return (
    <div className="space-y-2">
      {dims.map((dim, i) => (
        <div key={dim.key} className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-[#585858] w-5 text-center">{dim.label}</span>
          <div className="flex-1 bg-[#F6F6F6] rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full ${BAR_COLORS[i]} transition-all`}
              style={{ width: `${Math.min(dim.value, 100)}%` }}
            />
          </div>
          <span className="text-[11px] font-bold text-[#333] w-8 text-right">{dim.value}</span>
        </div>
      ))}
    </div>
  );
}
