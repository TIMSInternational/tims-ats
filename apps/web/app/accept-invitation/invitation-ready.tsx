import { buttonClasses } from '../../components/button-styles';

/** The success state: where to go next, and the two-step verification hand-off for roles that require it. */
export function InvitationReady({ open, mfaNext }: { open: string; mfaNext?: string }) {
  return (
    <>
      {mfaNext && (
        <p role="status" className="mt-6 rounded-xl bg-info-bg px-4 py-3 text-body text-info">
          {mfaNext}
        </p>
      )}
      {/* A full page load on purpose: the session was just adopted into this browser. */}
      <a href="/dashboard" className={buttonClasses({ size: 'lg', fullWidth: true, className: 'mt-6' })}>
        {open}
      </a>
    </>
  );
}
