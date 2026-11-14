/**
 * A failed submit, said inside the apply dialog the candidate is looking at (not a toast in a corner that
 * disappears): what went wrong, in candidate copy, until the next attempt.
 */
export function ApplySubmitError({ message }: { message: string }) {
  return (
    <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg bg-danger-bg p-3 text-callout text-danger">
      <svg className="mt-px size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
