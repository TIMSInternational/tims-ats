// The white card every auth screen sits in (staff sign-in, password recovery, registration, invitation).
// One width and one padding so the screens read as one flow (branding.md › Best practices); p-6 on phones
// leaves the fields room at 390px.
export function AuthCard({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`w-full ${wide ? 'max-w-lg' : 'max-w-md'}`}>
      <div className="rounded-2xl bg-white p-6 shadow-card sm:p-8">{children}</div>
    </div>
  );
}

/** The page's one h1: the task the card performs (writing.md › Best practices). */
export const AUTH_TITLE_CLASSES = 'font-display text-title font-semibold text-brand';
/** The line under the title. */
export const AUTH_SUBTITLE_CLASSES = 'mt-1 text-body text-muted';
/** Server / submit errors (field errors sit under their field instead). */
export const AUTH_ERROR_CLASSES = 'rounded-xl border border-danger/20 bg-danger-bg px-4 py-3 text-body text-danger';
/** Notices that are a state, not an error (session expired, MFA required). */
export const AUTH_NOTICE_CLASSES = 'rounded-xl border border-warning/20 bg-warning-bg px-4 py-3 text-body text-warning';
/** Secondary prompts under a form ("¿No tienes cuenta? …"). */
export const AUTH_PROMPT_CLASSES = 'text-center text-callout text-muted';
