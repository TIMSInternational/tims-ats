'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';

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

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href={`/careers/${encodeURIComponent(orgSlug)}`}
        className="text-[12px] text-[#585858] hover:text-[#1F114C]"
      >
        ← {pp.back}
      </Link>
      <h1 className="mt-4 text-[24px] font-bold text-[#1F114C]">{pp.title}</h1>
      <p className="mt-1 text-[13px] text-[#8B8B8B]">
        {pp.subtitle} · {orgName}
      </p>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold text-[#1F114C]">{pp.controllerHeading}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[#585858]">
          <span className="font-medium text-[#333]">{orgName}</span> {pp.controllerBody}
        </p>
      </section>

      {sections.map((s) => (
        <section key={s.heading} className="mt-6">
          <h2 className="text-[15px] font-semibold text-[#1F114C]">{s.heading}</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-[#585858]">{s.body}</p>
        </section>
      ))}

      <p className="mt-10 border-t border-[#EDEDED] pt-4 text-[11px] text-[#8B8B8B]">{pp.baseNotice}</p>
    </main>
  );
}
