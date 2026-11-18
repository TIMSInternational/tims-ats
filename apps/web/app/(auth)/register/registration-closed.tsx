'use client';

import { useI18n } from '../../../lib/i18n';
import { Button } from '../../../components/button';
import { AuthCard, AUTH_TITLE_CLASSES } from '../auth-card';

// Shown at /register when company self-registration is off (SELF_SERVE_SIGNUP_ENABLED): staff accounts
// are created by invitation only.
export function RegistrationClosed() {
  const { t } = useI18n();
  return (
    <AuthCard>
      <div className="text-center">
        <h1 className={`${AUTH_TITLE_CLASSES} mb-2`}>{t.auth.registrationClosedTitle}</h1>
        <p className="mb-6 text-body text-secondary">{t.auth.registrationClosedDesc}</p>
        <Button href="/login" size="lg" fullWidth>
          {t.auth.login}
        </Button>
      </div>
    </AuthCard>
  );
}
