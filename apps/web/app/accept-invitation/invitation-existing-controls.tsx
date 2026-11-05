import { invitationField as field } from './invitation-styles';

/**
 * Ways in for an invitee whose account already exists: recover the password by email and, outside the
 * pilot, Google / Microsoft. The pilot hides SSO (staff sign in with a password at /login, which offers no
 * SSO either), so an account completed here can always sign in again.
 */
export function InvitationExistingControls({
  busy,
  ssoEnabled,
  help,
  forgot,
  continueGoogle,
  continueMicrosoft,
  onRecover,
  onSocial,
}: {
  busy: boolean;
  ssoEnabled: boolean;
  help: string;
  forgot: string;
  continueGoogle: string;
  continueMicrosoft: string;
  onRecover: () => void;
  onSocial: (provider: 'google' | 'azure') => void;
}) {
  return (
    <>
      <p className="text-xs leading-5 text-slate-500">{help}</p>
      <button disabled={busy} type="button" className="w-full text-sm underline" onClick={onRecover}>
        {forgot}
      </button>
      {ssoEnabled && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button type="button" disabled={busy} className={field} onClick={() => onSocial('google')}>
            {continueGoogle}
          </button>
          <button type="button" disabled={busy} className={field} onClick={() => onSocial('azure')}>
            {continueMicrosoft}
          </button>
        </div>
      )}
    </>
  );
}
