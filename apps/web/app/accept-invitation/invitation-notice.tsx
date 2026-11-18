import { Button } from '../../components/button';
import { AUTH_NOTICE_CLASSES } from '../(auth)/auth-card';

/** A blocking message with one way forward (retry a failed load, or sign out another session first). */
export function InvitationNotice({
  message,
  action,
  onAction,
  busy = false,
  variant = 'primary',
}: {
  message: string;
  action: string;
  onAction: () => void;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <div className="mt-6">
      <p role="alert" className={AUTH_NOTICE_CLASSES}>
        {message}
      </p>
      <Button variant={variant} size="lg" fullWidth disabled={busy} onClick={onAction} className="mt-4">
        {action}
      </Button>
    </div>
  );
}
