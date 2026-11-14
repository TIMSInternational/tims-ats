'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { buttonClasses } from '../../../../../components/button-styles';
import { ErrorState } from '../../../../../components/error-state';
import { StatusBadge } from '../../../../../components/status-badge';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
import { DASHBOARD_CARD, DASHBOARD_ITEM, DASHBOARD_TITLE } from './dashboard-styles';
import { isSafeDailyJoinUrl } from '../../../../../lib/interview-join';
import { candidateTimeZone, formatCandidateDateTime } from '../../../../../lib/candidate-format';

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

// Times render in the zone the interview email used — the organization's, else the interview's vacancy
// company's, else UTC — with an explicit zone label.
export function DashboardInterviews({ orgSlug, timeZone = null }: { orgSlug: string; timeZone?: string | null }) {
  const { t, locale } = useI18n();
  const { data, isLoading, isError, refetch } = trpc.candidatePortal.myInterviews.useQuery({ orgSlug });

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

  const pd = t.portalDashboard;

  return (
    <section aria-labelledby="dashboard-interviews-title" className={DASHBOARD_CARD}>
      <h2 id="dashboard-interviews-title" className={DASHBOARD_TITLE}>
        {pd.interviews}
      </h2>

      {isLoading ? (
        <DashboardCardSkeleton label={pd.intLoading} rows={1} />
      ) : isError ? (
        <ErrorState size="compact" title={pd.intError} onRetry={() => void refetch()} />
      ) : (data ?? []).length === 0 ? (
        <p className="text-body text-secondary">{pd.intEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {(data ?? []).map((iv) => {
            const viaEmail = usesEmailJoinLink(iv.type, iv.meetingUrl);
            const joinUrl = viaEmail ? null : safeMeetingUrl(iv.meetingUrl);
            const locationIsLink = Boolean(iv.location && /^https?:\/\//i.test(iv.location.trim()));
            return (
              <li key={iv.id} className={DASHBOARD_ITEM}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <h3 className="break-words text-subheading font-semibold text-brand">{iv.vacancy.title}</h3>
                    {/* When it is: the one line the candidate needs most, so it is the largest after the title. */}
                    <p className="mt-1 text-subheading font-medium text-primary tabular-nums">
                      {formatCandidateDateTime(iv.scheduledAt, locale, candidateTimeZone(timeZone, iv.vacancy.company?.timezone))}
                      {iv.duration ? ` · ${iv.duration} ${pd.intMinutes}` : ''}
                    </p>
                    <p className="mt-0.5 text-callout text-secondary">{candidateInterviewTypeLabel(t, iv.type, joinUrl)}</p>
                    {iv.location && !isSameLink(iv.location, joinUrl) && (
                      <p className={`mt-1 text-callout text-secondary ${locationIsLink ? '[overflow-wrap:anywhere]' : 'break-words'}`}>
                        <span className="text-muted">{pd.intLocation}:</span> {iv.location}
                      </p>
                    )}
                  </div>
                  <StatusBadge tone="brand" className="self-start">
                    {statusLabel(iv.status)}
                  </StatusBadge>
                </div>

                {viaEmail && <p className="mt-3 text-callout text-secondary">{pd.intJoinViaEmail}</p>}
                {joinUrl && (
                  <a href={joinUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses({ className: 'mt-3' })}>
                    {pd.intJoin}
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
