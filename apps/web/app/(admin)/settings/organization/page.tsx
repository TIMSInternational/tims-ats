'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { timeZoneLabel } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../../components';
import { careersPageUrl, countryLabel, currencyLabel, languageLabel } from '../../../../lib/org-profile-format';

// /settings/organization — "Datos de la organización" (audit finding D-11). A read-only card that shows the
// country, currency, time zone, language, careers page and candidate contact mailbox exactly as the product
// resolves them, so an admin can verify the setup without asking support. Changes still go through support.
// Data: organization.getCurrent (an explicit, non-sensitive projection; no raw settings or billing data).

const SECTION_CLS = 'bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] max-w-3xl';

function Row({ label, value, hint }: { label: string; value: ReactNode; hint?: string | null }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-1 md:gap-4 py-3 border-b border-[#F3F3F3] last:border-0">
      <dt className="text-[12px] font-medium text-[#585858]">{label}</dt>
      <dd className="text-sm text-[#333] min-w-0 break-words">
        {value}
        {hint && <p className="mt-0.5 text-[11px] text-[#8B8B8B]">{hint}</p>}
      </dd>
    </div>
  );
}

export default function OrganizationProfilePage() {
  const { t, locale } = useI18n();
  const m = t.orgProfile;
  const ui = locale === 'EN' ? 'en' : 'es';
  const profile = trpc.organization.getCurrent.useQuery(undefined, { retry: false });
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);

  const missing = <span className="text-[#8B8B8B]">{m.notConfigured}</span>;
  const fromCompany = (company: string | null) => (company ? m.fromCompany.replace('{company}', company) : null);

  let body: ReactNode;
  if (profile.isLoading) body = <Skeleton className="h-48 w-full rounded-lg" />;
  else if (profile.isError || !profile.data) body = <ErrorState onRetry={() => void profile.refetch()} error={profile.error} />;
  else {
    const p = profile.data;
    const careers = origin ? careersPageUrl(origin, p.slug) : null;
    body = (
      <dl>
        <Row label={m.name} value={p.name} />
        <Row label={m.country} value={countryLabel(p.country, ui) ?? missing} />
        <Row
          label={m.currency}
          value={currencyLabel(p.currency, ui) ?? missing}
          hint={p.currencySource === 'company' ? fromCompany(p.companyName) : null}
        />
        <Row
          label={m.timeZone}
          value={p.timeZone ? `${timeZoneLabel(p.timeZone, ui)} · ${p.timeZone}` : m.timeZoneUtc}
          hint={p.timeZoneSource === 'company' ? fromCompany(p.companyName) : m.timeZoneHint}
        />
        <Row label={m.language} value={languageLabel(p.locale, ui) ?? missing} />
        <Row
          label={m.careersUrl}
          value={
            careers ? (
              <a
                href={careers}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#1F114C] underline underline-offset-2"
              >
                {careers}
              </a>
            ) : (
              missing
            )
          }
        />
        <Row
          label={m.candidateContact}
          value={
            p.candidateContactEmail ?? (
              <span className="text-[#8B8B8B]">
                {p.candidateContactSource === 'billing' ? m.candidateContactBilling : m.candidateContactMissing}
              </span>
            )
          }
          hint={p.candidateContactEmail ? m.candidateContactHint : null}
        />
      </dl>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#1F114C]">{m.title}</h1>
        <p className="mt-1 text-sm text-[#8B8B8B]">{m.subtitle}</p>
      </header>
      <section className={SECTION_CLS} aria-label={m.title}>
        {body}
      </section>
    </div>
  );
}
