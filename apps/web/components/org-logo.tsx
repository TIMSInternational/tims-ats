'use client';

import { useState } from 'react';
import { isCspAllowedImageUrl } from '../lib/security/csp-img-src';

interface OrgLogoProps {
  /** `organizations.logo` (a URL), or null when the organization has none. */
  logo: string | null | undefined;
  name: string;
  /** Classes for the image (size, rounding, fit). */
  imgClassName: string;
  /** Classes for the initial tile shown when there is no usable logo. */
  fallbackClassName: string;
  /** The organization name is already written next to the logo: hide the logo from assistive tech. */
  decorative?: boolean;
}

/**
 * The organization's logo on candidate-facing pages, or a tile with its initial. A logo URL the
 * Content-Security-Policy would block (img-src) — or one that fails to load — is never rendered as
 * a broken image: the initial tile is shown instead.
 */
export function OrgLogo({ logo, name, imgClassName, fallbackClassName, decorative = false }: OrgLogoProps) {
  const [failed, setFailed] = useState(false);
  const url = logo?.trim() ?? '';
  const usable = url.length > 0 && !failed && isCspAllowedImageUrl(url);

  if (usable) {
    // A plain img element: next/image would need every tenant host listed in next.config remotePatterns.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={decorative ? '' : name} className={imgClassName} onError={() => setFailed(true)} />;
  }
  return (
    <span className={fallbackClassName} {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}
