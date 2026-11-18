'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { TEXT_LINK_CLASSES } from '../../../../../components/button-styles';

interface PrivacyNoticeProps {
  orgName: string;
  orgSlug: string;
}

export function PrivacyNotice({ orgName, orgSlug }: PrivacyNoticeProps) {
  const { t } = useI18n();
  const pp = t.portalPrivacy;
  const sections = [
    { heading: pp.dataHeading, body: pp.dataBody },
    { heading: pp.purposeHeading, body: pp.purposeBody },
    { heading: pp.rightsHeading, body: pp.rightsBody },
    { heading: pp.exerciseHeading, body: pp.exerciseBody },
  ];

  const body = 'mt-2 max-w-prose text-base leading-relaxed text-secondary sm:text-body';
  const heading = 'text-heading font-semibold text-brand';

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">
      <Link href={`/careers/${encodeURIComponent(orgSlug)}`} className={`${TEXT_LINK_CLASSES} min-h-7 text-callout`}>
        <svg className="size-4" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
          <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {pp.back}
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
