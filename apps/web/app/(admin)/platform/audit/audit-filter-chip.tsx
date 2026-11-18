'use client';

/** One active audit filter, with a button that removes it (44px hit area on touch). */
export function AuditFilterChip({
  label,
  removeLabel,
  onRemove,
}: {
  label: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-brand-tint py-0.5 pl-2.5 pr-1 text-callout font-medium text-brand">
      {label}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={onRemove}
        className="flex size-5 items-center justify-center rounded-full hover:bg-brand/10 pointer-coarse:size-11"
      >
        <svg
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  );
}
