'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { isSafeDailyJoinUrl } from '../../../../../lib/interview-join';
import { formatCandidateDateTime } from '../../../../../lib/candidate-format';

// "My Interviews" section of the candidate dashboard (Wave 1 Slice 3). Lists the
// signed-in candidate's UPCOMING interviews (scheduled/confirmed) with a join link
// when a meeting URL exists. Data comes from candidatePortal.myInterviews, scoped
// server-side to this candidate; orgSlug is the only input.

// Only treat a meeting URL as a clickable link when it is an absolute https URL.
// The URL is staff-set, but this is a cheap defense against a javascript:/data:
// scheme ever reaching an href.
//
// A video interview on our own Daily room is PRIVATE: its raw URL is a dead end without the meeting token
// the candidate's emailed /interview/join/<token> link mints (the portal never has that token). So for
// those the raw URL is never linked; the candidate is pointed at the email instead. An external link
// (Zoom, Meet, Teams…) keeps its Join button.
function usesEmailJoinLink(type: string, url: string | null): boolean {
  return type === 'video' && (!url || isSafeDailyJoinUrl(url));
}

function safeMeetingUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

type PortalTranslations = ReturnType<typeof useI18n>['t'];

const TYPE_KEYS = {
  phone: 'intTypePhone',
  video: 'intTypeVideo',
  technical: 'intTypeTechnical',
  cultural: 'intTypeCultural',
  panel: 'intTypePanel',
  onsite: 'intTypeOnsite',
  in_person: 'intTypeOnsite',
  online: 'intTypeOnline',
} as const;

/** Types that say WHERE the interview is: with a meeting link they read "En línea". */
const PLACE_TYPES: ReadonlySet<string> = new Set(['onsite', 'in_person', 'online']);

/**
 * The interview type in the candidate's language — never the raw enum ("Onsite") — and honest about
 * the modality: a pasted Teams/Meet/Zoom link is an ONLINE interview, not "Presencial" (C-02, C-03).
 */
export function candidateInterviewTypeLabel(t: PortalTranslations, type: string, joinUrl: string | null): string {
  const p = t.portalDashboard;
  const key = (TYPE_KEYS as Record<string, (typeof TYPE_KEYS)[keyof typeof TYPE_KEYS]>)[type];
  const label = key ? p[key] : p.intTypeOther;
  if (!joinUrl || type === 'video') return label;
  return PLACE_TYPES.has(type) ? p.intTypeOnline : `${label} (${p.intTypeOnlineSuffix})`;
}

/** The schedule modal stores a pasted link as both location and meeting URL: show it once (as Join). */
function isSameLink(location: string | null, url: string | null): boolean {
  if (!location || !url) return false;
  if (location.trim() === url) return true;
  try {
    return new URL(location.trim()).toString() === url;
  } catch {
    return false;
  }
}

// Times render in the organization's time zone with an explicit zone label (UTC when it has none).
export function DashboardInterviews({ orgSlug, timeZone = null }: { orgSlug: string; timeZone?: string | null }) {
  const { t, locale } = useI18n();
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
        <p className="text-[12px] text-muted">{t.portalDashboard.intLoading}</p>
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
        <p className="text-[12px] text-muted">{t.portalDashboard.intEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {interviews.map((iv) => {
            const viaEmail = usesEmailJoinLink(iv.type, iv.meetingUrl);
            const joinUrl = viaEmail ? null : safeMeetingUrl(iv.meetingUrl);
            return (
              <li key={iv.id} className="rounded-xl border border-[#EDEDED] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold text-[#1F114C] truncate">{iv.vacancy.title}</p>
                    <p className="text-[12px] text-[#585858] mt-0.5">{candidateInterviewTypeLabel(t, iv.type, joinUrl)}</p>
                    <p className="text-[11px] text-muted mt-1">
                      {formatCandidateDateTime(iv.scheduledAt, locale, timeZone, t.portalDashboard)}
                      {iv.duration ? ` · ${iv.duration} ${t.portalDashboard.intMinutes}` : ''}
                    </p>
                    {iv.location && !isSameLink(iv.location, joinUrl) && (
                      <p className="text-[11px] text-muted mt-0.5 break-all">
                        {t.portalDashboard.intLocation}: {iv.location}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#F4F1FF] px-2.5 py-1 text-[11px] font-medium text-[#1F114C]">
                    {statusLabel(iv.status)}
                  </span>
                </div>

                {viaEmail && <p className="mt-3 text-[12px] text-[#585858]">{t.portalDashboard.intJoinViaEmail}</p>}
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
