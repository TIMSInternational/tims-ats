/** The green check above an MFA success state (the word beside it carries the meaning, not the colour). */
export function MfaSuccessIcon() {
  return (
    <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-success-bg">
      <svg className="size-6 text-success" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}
