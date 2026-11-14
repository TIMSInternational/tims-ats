import { Button } from '../../components/button';

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
      <p role="alert" className="rounded-xl border border-warning/20 bg-warning-bg px-4 py-3 text-body text-warning">
        {message}
      </p>
      <Button variant={variant} size="lg" fullWidth disabled={busy} onClick={onAction} className="mt-4">
        {action}
      </Button>
    </div>
  );
}
