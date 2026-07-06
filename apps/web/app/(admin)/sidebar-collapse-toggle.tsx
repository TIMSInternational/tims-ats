'use client';

export function SidebarCollapseToggle({
  expanded,
  onToggle,
  collapseLabel,
  expandLabel,
}: {
  expanded: boolean;
  onToggle: () => void;
  collapseLabel: string;
  expandLabel: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-center w-[26px] h-[26px] rounded-[var(--r-sm)] text-[var(--chrome-text-tertiary)] hover:bg-[var(--chrome-hover)] transition-colors shrink-0"
      aria-label={expanded ? collapseLabel : expandLabel}
    >
      {expanded ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M9 4v16M15 4v16" />
          <path d="M15 12H4M8 8l-4 4 4 4" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M9 4v16M15 4v16" />
          <path d="M9 12h11M15 8l4 4-4 4" />
        </svg>
      )}
    </button>
  );
}
