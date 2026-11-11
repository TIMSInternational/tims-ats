'use client';

// The few marks every TIMS results chart is built from, drawn in SVG so a value never needs an inline style: one data
// colour (TIMS navy) on one track colour, a neutral dashed marker for a vacancy minimum, and the value always printed as
// text beside the mark (nothing is read from colour or length alone).

/** Replaces each `{name}` in a message with its value. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

/** 12.0 → "12", 1.44 → "1.4": a percentile or percentage as people read it. */
export function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/**
 * A horizontal 0–`max` meter: the track, the value's bar, and an optional dashed minimum marker. Decorative to assistive
 * technology: the caller prints the value next to it and labels the group.
 */
export function MeterBar({
  value,
  max = 100,
  minimum,
}: {
  value: number | null;
  max?: number;
  minimum?: number | null;
}) {
  const width = value === null ? 0 : (Math.max(0, Math.min(max, value)) / max) * 100;
  const marker = minimum === null || minimum === undefined ? null : (Math.max(0, Math.min(max, minimum)) / max) * 100;
  return (
    <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-2.5 w-full overflow-visible" aria-hidden="true">
      <rect x="0" y="2" width="100" height="6" rx="3" className="fill-[#ECEAF3]" />
      {width > 0 && <rect x="0" y="2" width={width} height="6" rx="3" className="fill-[#1F114C]" />}
      {marker !== null && (
        <line
          x1={marker}
          x2={marker}
          y1="0"
          y2="10"
          className="stroke-[#333333]"
          strokeWidth="1.5"
          strokeDasharray="2 1.5"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}

/** A 1-to-`max` level as filled dots (competencies). Decorative: the caller prints "Level n of max". */
export function LevelDots({ level, max }: { level: number; max: number }) {
  return (
    <span className="flex gap-1" aria-hidden="true">
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${i < level ? 'bg-[#1F114C]' : 'bg-[#ECEAF3] ring-1 ring-inset ring-[#D9D5E6]'}`}
        />
      ))}
    </span>
  );
}

/** The quiet line under an advisory profile: what it describes, and that it never decides. */
export function AdvisoryNote({ text }: { text: string }) {
  return <p className="mt-4 border-t border-[#F1F0F5] pt-3 text-[12px] leading-5 text-[#6B6B6B]">{text}</p>;
}
