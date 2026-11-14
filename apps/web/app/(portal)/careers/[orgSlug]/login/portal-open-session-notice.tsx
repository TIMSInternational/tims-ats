'use client';

import { Button } from '../../../../../components/button';

interface PortalOpenSessionNoticeProps {
  message: string;
  action: string;
  failed: string | null;
  busy: boolean;
  onContinue: () => void;
}

/** "Tiene una sesión abierta como {email}" with the explicit sign-out that lets the candidate continue (E-19). */
export function PortalOpenSessionNotice({ message, action, failed, busy, onContinue }: PortalOpenSessionNoticeProps) {
  return (
    <div role="alert" className="mb-5 rounded-lg bg-warning-bg p-3 text-callout text-warning">
      <p>{message}</p>
      {failed && <p className="mt-2 font-medium text-danger">{failed}</p>}
      {/* Secondary: the sign-in form below keeps the page's one primary action. */}
      <Button variant="secondary" onClick={onContinue} loading={busy} className="mt-3">
        {action}
      </Button>
    </div>
  );
}
