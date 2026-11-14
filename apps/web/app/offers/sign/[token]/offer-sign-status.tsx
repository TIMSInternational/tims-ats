'use client';

import { OrgLogo } from '../../../../components/org-logo';

export type SignStatusTone = 'brand' | 'success' | 'danger' | 'neutral';

const TONE: Record<SignStatusTone, string> = {
  brand: 'bg-brand-tint text-brand',
  success: 'bg-success-bg text-success',
  danger: 'bg-danger-bg text-danger',
  neutral: 'bg-surface text-secondary',
};

interface OfferSignStatusProps {
  tone: SignStatusTone;
  /** One outline path (Heroicons outline 1.5 / 2). */
  icon: string;
  circle?: boolean;
  title: string;
  subtitle: string;
  /** While loading: a pulsing mark and aria-busy. */
  pulse?: boolean;
  /** Who the offer is from, whenever the offer is known (the candidate never sees an anonymous card). */
  organization?: { name: string; logo: string | null };
}

/** A whole-page state of the public signing page: loading, invalid link, answered, accepted, declined. */
export function OfferSignStatus({ tone, icon, circle, title, subtitle, pulse, organization }: OfferSignStatusProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-hover p-4" aria-busy={pulse || undefined}>
      <div role={pulse ? undefined : 'status'} className="w-full max-w-lg rounded-2xl bg-white p-8 text-center shadow-popover sm:p-10">
        {organization && (
          <div className="mb-6 flex items-center justify-center gap-3">
            <OrgLogo
              logo={organization.logo}
              name={organization.name}
              imgClassName="h-9 w-9 rounded-lg object-contain"
              fallbackClassName="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-subheading font-semibold text-white"
              decorative
            />
            <span className="text-subheading font-semibold text-primary">{organization.name}</span>
          </div>
        )}
        <div className={`mx-auto mb-4 flex size-14 items-center justify-center rounded-full ${TONE[tone]} ${pulse ? 'animate-pulse' : ''}`}>
          <svg className="size-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            {circle && <circle cx="12" cy="12" r="10" />}
            <path d={icon} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mb-2 font-display text-title font-semibold text-primary">{title}</h1>
        <p className="mx-auto max-w-prose text-base text-secondary sm:text-body">{subtitle}</p>
      </div>
    </main>
  );
}
