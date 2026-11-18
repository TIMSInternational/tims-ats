'use client';

/** One quiet "your role can't do this" line with a lock icon (settings-17). */
export function ForbiddenLine({ text }: { text: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-callout text-secondary">
      <svg
        className="size-4 shrink-0 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      {text}
    </p>
  );
}
