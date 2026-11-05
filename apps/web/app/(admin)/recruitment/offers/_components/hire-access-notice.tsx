'use client';

import { useI18n } from '../../../../../lib/i18n';

/** What convertToEmployee says it sent to the new employee (packages/api hire-access.service.ts). */
export type HireAccess =
  | { kind: 'invitation_sent'; email: string }
  | { kind: 'setup_link_sent'; email: string }
  | { kind: 'setup_link_failed'; email: string };

/**
 * E-06 / B-07: after "Crear colaborador y plan" the screen states exactly how the new employee gets in —
 * an invitation, a set-password email (when they already had candidate access), or, when nothing could be
 * sent, what to tell them (/login → "¿Olvidaste tu contraseña?" with the same email).
 */
export function HireAccessNotice({ access, loginUrl }: { access: HireAccess; loginUrl: string }) {
  const { t } = useI18n();
  const failed = access.kind === 'setup_link_failed';
  const message =
    access.kind === 'invitation_sent'
      ? t.offers.hireAccessInvitationSent
      : access.kind === 'setup_link_sent'
        ? t.offers.hireAccessSetupLinkSent
        : t.offers.hireAccessSetupLinkFailed;

  return (
    <div
      role={failed ? 'alert' : 'status'}
      className={`rounded-lg border px-4 py-3 text-[12px] ${
        failed ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-green-200 bg-green-50 text-green-800'
      }`}
    >
      <p className="font-semibold">{t.offers.hireAccessTitle}</p>
      <p className="mt-0.5">{message.replace('{email}', access.email).replace('{loginUrl}', loginUrl)}</p>
    </div>
  );
}
