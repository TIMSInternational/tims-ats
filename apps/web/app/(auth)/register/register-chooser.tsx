'use client';

import { RegisterForm } from './register-form';
import { AuthCard, AUTH_PROMPT_CLASSES } from '../auth-card';
import { useI18n } from '../../../lib/i18n';

// Candidate self-registration was removed: candidates are not staff and never get a
// `User` row — they apply through an employer's careers link, which creates a
// Candidate record and signs them in via a portal magic-link (see the candidate
// portal). /register is for COMPANIES (org admins) only, so it opens on the company form instead of a
// chooser with one option (onboarding.md › Additional requests: provide reasonable defaults).
export function RegisterChooser() {
  const { t } = useI18n();
  return (
    <AuthCard>
      <RegisterForm accountType="company" />
      <p className={`${AUTH_PROMPT_CLASSES} mt-4`}>{t.auth.candidateApplyHint}</p>
    </AuthCard>
  );
}
