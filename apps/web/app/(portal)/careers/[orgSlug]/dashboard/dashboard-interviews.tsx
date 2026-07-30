'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';

// "My Interviews" section of the candidate dashboard (Wave 1 Slice 3). Lists the
// signed-in candidate's UPCOMING interviews (scheduled/confirmed) with a join link
// when a meeting URL exists. Data comes from candidatePortal.myInterviews, scoped
// server-side to this candidate; orgSlug is the only input.

// Only treat a meeting URL as a clickable link when it is an absolute https URL.
// The URL is staff-set, but this is a cheap defense against a javascript:/data:
// scheme ever reaching an href.
function safeMeetingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function DashboardInterviews({ orgSlug }: { orgSlug: string }) {
  const { t } = useI18n();
  const { data, isLoading, isError } = trpc.candidatePortal.myInterviews.useQuery({ orgSlug });

  const statusLabel = (s: string) => {
    switch (s) {
      case 'scheduled':
        return t.portalDashboard.intStatusScheduled;
      case 'confirmed':
        return t.portalDashboard.intStatusConfirmed;
      case 'rescheduled':
        return t.portalDashboard.intStatusRescheduled;
      default:
        return s;
    }
  };

  const header = <h2 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.portalDashboard.interviews}</h2>;

  if (isLoading) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.intLoading}</p>
      </section>
    );
  }
  if (isError) {
    return (
      <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
        {header}
        <p className="text-[12px] text-[#B42318]">{t.portalDashboard.intError}</p>
      </section>
    );
  }

  const interviews = data ?? [];

  return (
    <section className="bg-white rounded-2xl border border-[#EDEDED] p-5">
      {header}

      {interviews.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.portalDashboard.intEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {interviews.map((iv) => {
            const joinUrl = safeMeetingUrl(iv.meetingUrl);
            return (
              <li key={iv.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">{iv.vacancy.title}</p>
                    <p className="text-[12px] text-[#585858] mt-0.5 capitalize">{iv.type}</p>
                    <p className="text-[11px] text-[#8B8B8B] mt-1">
                      {new Date(iv.scheduledAt).toLocaleString()}
                      {iv.duration ? ` · ${iv.duration} ${t.portalDashboard.intMinutes}` : ''}
                    </p>
                    {iv.location && (
                      <p className="text-[11px] text-[#8B8B8B] mt-0.5">
                        {t.portalDashboard.intLocation}: {iv.location}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F4F1FF] px-2.5 py-1 text-[11px] font-medium text-[#1F114C]">
                    {statusLabel(iv.status)}
                  </span>
                </div>

                {joinUrl && (
                  <a
                    href={joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex h-9 items-center rounded-xl bg-[#1F114C] px-4 text-[12px] font-semibold text-white hover:bg-[#2a1a5e] transition"
                  >
                    {t.portalDashboard.intJoin}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
