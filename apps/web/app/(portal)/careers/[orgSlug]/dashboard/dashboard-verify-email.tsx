'use client';

import { MailCheck } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import { usePortalOrgBrand } from '../_components/portal-org-brand';
import { EvalPage } from './eval-page';
import { EvalBigIcon } from './eval-big-icon';
import { EvalButton } from './eval-button';
import { EVAL_EYEBROW_CLASSES, EVAL_LEAD_CLASSES, EVAL_STATE_CLASSES, EVAL_TITLE_CLASSES } from './eval-styles';

// Shown instead of the dashboard when the session's email is not confirmed: the portal identifies a candidate by
// email, so an unverified address must never open anyone's application history or privacy actions
// (docs/architecture/candidate-portal-email-verification.md). Drawn as a PCA state screen (StateLayout: BigIcon,
// eyebrow, serif title, lead, one action) inside the dashboard's own navy page and header.
const ICON_CLASSES = 'self-start';
const EYEBROW_CLASSES = `${EVAL_EYEBROW_CLASSES} mt-5`;
const TITLE_CLASSES = `${EVAL_TITLE_CLASSES} mt-2`;
const LEAD_CLASSES = `${EVAL_LEAD_CLASSES} mt-2.5 md:text-eval-md`;
const ACTION_CLASSES = 'mt-6 self-stretch md:self-start';

export function DashboardVerifyEmail({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  const brand = usePortalOrgBrand();
  return (
    <EvalPage orgSlug={orgSlug} orgName={brand?.name ?? null} orgLogo={brand?.logo ?? null} width="narrow">
      <div className={EVAL_STATE_CLASSES}>
        <EvalBigIcon tone="accent" className={ICON_CLASSES}>
          <MailCheck aria-hidden="true" />
        </EvalBigIcon>
        <p className={EYEBROW_CLASSES}>{m.eyebrow}</p>
        <h1 className={TITLE_CLASSES}>{m.verifyEmailTitle}</h1>
        <p className={LEAD_CLASSES}>{m.verifyEmailDesc}</p>
        <EvalButton href={`/careers/${orgSlug}/login`} width="bar" className={ACTION_CLASSES}>
          {m.verifyEmailAction}
        </EvalButton>
      </div>
    </EvalPage>
  );
}
