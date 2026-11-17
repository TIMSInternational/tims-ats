'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { ProviderFrameBrand } from './provider-frame-brand';
import {
  FRAME_DIVIDER_CLASSES,
  FRAME_HEADER_CLASSES,
  FRAME_HEADER_END_CLASSES,
  FRAME_HEADER_START_CLASSES,
} from './provider-frame-styles';
import { EvalOrgLogo } from './eval-org-logo';
import { EVAL_ORG_LINK_CLASSES } from './eval-styles';

/**
 * The PCA header over the candidate dashboard, exactly the frame's (56px / 68px, px 18 / 56, white on navy, not sticky):
 * on the left a link back to the organization's job board holding its logo (or the dashed chip with its name), the
 * 1×22px divider from md, and the TIMS mark + "TIMS International" (the word from md); on the right `children` (the
 * "Sign out" control, FRAME_LEAVE_CLASSES). `tims-chrome` (in FRAME_HEADER_CLASSES) turns the focus ring white.
 */
export function EvalPageHeader({
  orgSlug,
  orgName,
  orgLogo,
  children,
}: {
  orgSlug: string;
  /** Null when the organization is not known here: the header then shows only the TIMS brand. */
  orgName: string | null;
  orgLogo: string | null | undefined;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <header className={FRAME_HEADER_CLASSES}>
      <div className={FRAME_HEADER_START_CLASSES}>
        {orgName && (
          <>
            <Link href={`/careers/${orgSlug}`} className={EVAL_ORG_LINK_CLASSES}>
              <EvalOrgLogo name={orgName} logo={orgLogo} />
            </Link>
            <span aria-hidden="true" className={FRAME_DIVIDER_CLASSES} />
          </>
        )}
        <ProviderFrameBrand label={t.portalDashboard.providerFrameBrand} />
      </div>
      {children && <div className={FRAME_HEADER_END_CLASSES}>{children}</div>}
    </header>
  );
}
