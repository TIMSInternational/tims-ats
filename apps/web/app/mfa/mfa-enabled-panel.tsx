'use client';

import { useI18n } from '../../lib/i18n';
import { Button } from '../../components/button';
import { buttonClasses } from '../../components/button-styles';
import { AUTH_ERROR_CLASSES } from '../(auth)/auth-card';
import { MfaSuccessIcon } from './mfa-success-icon';

// MFA is on: go back, or (when the role allows it) turn it off after a confirmation that names the
// consequence. Cancel leads, the destructive verb trails (alerts.md › Buttons).
export function MfaEnabledPanel({
  required,
  error,
  busy,
  confirming,
  onConfirming,
  onDisable,
}: {
  required: boolean;
  error: string;
  busy: boolean;
  confirming: boolean;
  onConfirming: (value: boolean) => void;
  onDisable: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="text-center">
      <MfaSuccessIcon />
      <h2 className="mb-1 text-heading font-semibold text-brand">{t.mfa.enabledTitle}</h2>
      <p className="mb-6 text-body text-secondary">{t.mfa.enabledDesc}</p>
      <a href="/dashboard" className={buttonClasses({ size: 'lg', fullWidth: true, className: 'mb-4' })}>
        {t.mfa.backToDashboard}
      </a>
      {error && (
        <div role="alert" className={`mb-3 ${AUTH_ERROR_CLASSES}`}>
          {error}
        </div>
      )}
      {required ? (
        <p className="text-callout text-muted">{t.mfa.requiredCannotDisable}</p>
      ) : confirming ? (
        <div className="rounded-xl border border-danger/20 bg-danger-bg p-4 text-left">
          <p className="mb-3 text-body text-danger">{t.mfa.disableConfirm}</p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => onConfirming(false)}>
              {t.mfa.cancel}
            </Button>
            <Button variant="destructive" fullWidth loading={busy} loadingLabel={t.mfa.disabling} onClick={onDisable}>
              {t.mfa.disableConfirmBtn}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="destructive-secondary" onClick={() => onConfirming(true)}>
          {t.mfa.disable}
        </Button>
      )}
    </div>
  );
}
