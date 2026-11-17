'use client';

import { useState } from 'react';
import { isCspAllowedImageUrl } from '../../../../../lib/security/csp-img-src';
import { EVAL_ORG_CHIP_CLASSES, EVAL_ORG_CHIP_TEXT_CLASSES, EVAL_ORG_LOGO_IMG_CLASSES } from './eval-styles';

/**
 * The organization in the PCA navy header: its uploaded logo (max 30px tall / 140px wide on phones, 34 / 180 from md),
 * named by the organization's name; without a usable logo (none, blocked by the CSP's img-src, or failing to load) the
 * PCA's dashed chip with the name. Never a broken image (the shared OrgLogo's rule; its initial tile is not the PCA's).
 */
export function EvalOrgLogo({ name, logo }: { name: string; logo: string | null | undefined }) {
  const [failed, setFailed] = useState(false);
  const url = logo?.trim() ?? '';
  if (url.length > 0 && !failed && isCspAllowedImageUrl(url)) {
    // A plain img: next/image would need every tenant host in next.config remotePatterns.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className={EVAL_ORG_LOGO_IMG_CLASSES} onError={() => setFailed(true)} />;
  }
  return (
    <span className={EVAL_ORG_CHIP_CLASSES}>
      <span className={EVAL_ORG_CHIP_TEXT_CLASSES}>{name}</span>
    </span>
  );
}
