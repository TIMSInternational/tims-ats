'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { TEXT_LINK_CLASSES } from '../../../../../components/button-styles';

interface PrivacyNoticeLey8968Props {
  orgName: string;
  orgSlug: string;
  /** This organization's candidate contact mailbox (resolved server side), or null when it has none. */
  contactEmail: string | null;
}

// Costa Rica (Ley N.° 8968) candidate privacy notice: what is processed, why, with which automated tools
// (including AI), where it is stored (international transfer), for how long, and how to exercise the data
// subject's rights. Rendered only for the 'ley8968' consent variant (page.tsx), which is off by default.
// The wording (`portalPrivacyLey8968.*`) is a draft pending counsel review: see LEY_8968_NOTICE_TEXT_FINAL.
export function PrivacyNoticeLey8968({ orgName, orgSlug, contactEmail }: PrivacyNoticeLey8968Props) {
  const { t } = useI18n();
  const pp = t.portalPrivacyLey8968;
  // The notice text is shared by every organization, so the contact channel is never part of it: the
  // organization's own mailbox is interpolated into {email}, and with none configured the candidate is
  // pointed to the organization's official channels — never to another organization's or a platform address.
  const emailParts = pp.exerciseBody.split('{email}');
  const exerciseBody: ReactNode =
    contactEmail && emailParts.length === 2 ? (
      <>
        {emailParts[0]}
        <a href={`mailto:${contactEmail}`} className="font-medium text-brand underline hover:text-brand-hover">
          {contactEmail}
        </a>
        {emailParts[1]}
      </>
    ) : (
      pp.exerciseBodyNoContact
    );
  const sections: { heading: string; body: ReactNode }[] = [
    { heading: pp.dataHeading, body: pp.dataBody },
    { heading: pp.purposeHeading, body: pp.purposeBody },
    { heading: pp.aiHeading, body: pp.aiBody },
    { heading: pp.transferHeading, body: pp.transferBody },
    { heading: pp.retentionHeading, body: pp.retentionBody },
    { heading: pp.rightsHeading, body: pp.rightsBody },
    { heading: pp.exerciseHeading, body: exerciseBody },
  ];

  const body = 'mt-2 max-w-prose text-base leading-relaxed text-secondary sm:text-body';
  const heading = 'text-heading font-semibold text-brand';

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <Link href={`/careers/${encodeURIComponent(orgSlug)}`} className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path
            d="M10 12L6 8l4-4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        {t.portalPrivacy.back}
      </Link>
      <h1 className="mt-4 font-display text-title font-bold text-brand sm:text-display">{pp.title}</h1>
      <p className="mt-1 text-subheading text-secondary sm:text-callout">
        {pp.subtitle} · {orgName}
      </p>

      <section className="mt-8">
        <h2 className={heading}>{pp.controllerHeading}</h2>
        <p className={body}>
          <span className="font-medium text-primary">{orgName}</span> {pp.controllerBody}
        </p>
      </section>

      {sections.map((s) => (
        <section key={s.heading} className="mt-6">
          <h2 className={heading}>{s.heading}</h2>
          <p className={body}>{s.body}</p>
        </section>
      ))}

      <p className="mt-10 max-w-prose border-t border-border pt-4 text-callout text-secondary">{pp.baseNotice}</p>
    </main>
  );
}
