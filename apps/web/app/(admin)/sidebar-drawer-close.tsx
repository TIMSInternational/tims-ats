'use client';

// Close button for the mobile sidebar drawer. Rendered in the logo bar in place of the collapse toggle,
// which is desktop-only (the drawer always shows the expanded sidebar, so collapsing it means nothing).
export function SidebarDrawerClose({ onClose, label }: { onClose: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className="md:hidden flex items-center justify-center w-9 h-9 rounded-[var(--r-sm)] text-[var(--chrome-text-tertiary)] hover:bg-[var(--chrome-hover)] transition-colors shrink-0"
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24" aria-hidden>
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}
