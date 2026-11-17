'use client';

import type { ReactNode } from 'react';
import { CalendarCheck, CalendarClock, ExternalLink, Mail } from 'lucide-react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { EvalCallout } from './eval-callout';
import { EvalChip } from './eval-chip';
import { EvalLoadError } from './eval-load-error';
import { evalButtonClasses } from './eval-control-styles';
import { EVAL_FOOTNOTE_CLASSES } from './eval-styles';
import { DashboardCardSkeleton } from './dashboard-card-skeleton';
import {
  DASHBOARD_CARD,
  DASHBOARD_EMPTY,
  DASHBOARD_ITEM,
  DASHBOARD_ITEM_HEAD,
  DASHBOARD_ITEM_TITLE,
  DASHBOARD_LIST,
  DASHBOARD_TITLE,
} from './dashboard-styles';
import { isSafeDailyJoinUrl } from '../../../../../lib/interview-join';
import { candidateTimeZone, formatCandidateDateTime } from '../../../../../lib/candidate-format';

// The panel's parts in the TIMS evaluation design (PCA). Constants only: never a class list inside a ternary.
const TITLE_BLOCK = 'min-w-0';
/** When it is: the one line the candidate needs most, so it is the largest after the title (16px ink semibold). */
const WHEN_LINE = 'm-0 mt-1.5 text-eval-md leading-[1.4] font-semibold text-eval-ink tabular-nums';
const TYPE_LINE = `${EVAL_FOOTNOTE_CLASSES} mt-1`;
/** The place: ordinary words wrap at spaces; only a pasted URL may break anywhere. */
const PLACE_LINE = 'm-0 mt-1 text-eval-sm text-eval-ink';
const PLACE_WORDS = `${PLACE_LINE} break-words`;
const PLACE_URL = `${PLACE_LINE} [overflow-wrap:anywhere]`;
const PLACE_LABEL = 'text-eval-ink2';
const VIA_EMAIL = 'mt-4';
/** The external meeting link as the PCA primary button: full width on phones, its content from md. */
const JOIN_LINK = evalButtonClasses({ width: 'bar', className: 'mt-4' });

/** The chip's icon per interview status (word + icon, never colour alone). */
const STATUS_ICON: Record<string, ReactNode> = {
  scheduled: <CalendarClock aria-hidden="true" />,
  confirmed: <CalendarCheck aria-hidden="true" />,
  rescheduled: <CalendarClock aria-hidden="true" />,
};

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
        <EvalLoadError title={pd.intError} onRetry={() => void refetch()} />
      ) : (data ?? []).length === 0 ? (
        <p className={DASHBOARD_EMPTY}>{pd.intEmpty}</p>
      ) : (
        <ul className={DASHBOARD_LIST}>
          {(data ?? []).map((iv) => {
            const viaEmail = usesEmailJoinLink(iv.type, iv.meetingUrl);
            const joinUrl = viaEmail ? null : safeMeetingUrl(iv.meetingUrl);
            const locationIsLink = Boolean(iv.location && /^https?:\/\//i.test(iv.location.trim()));
            return (
              <li key={iv.id} className={DASHBOARD_ITEM}>
                <div className={DASHBOARD_ITEM_HEAD}>
                  <div className={TITLE_BLOCK}>
                    <h3 className={DASHBOARD_ITEM_TITLE}>{iv.vacancy.title}</h3>
                    {/* When it is: the one line the candidate needs most, so it is the largest after the title. */}
                    <p className={WHEN_LINE}>
                      {formatCandidateDateTime(
                        iv.scheduledAt,
                        locale,
                        candidateTimeZone(timeZone, iv.vacancy.company?.timezone),
                      )}
                      {iv.duration ? ` · ${iv.duration} ${pd.intMinutes}` : ''}
                    </p>
                    <p className={TYPE_LINE}>{candidateInterviewTypeLabel(t, iv.type, joinUrl)}</p>
                    {iv.location && !isSameLink(iv.location, joinUrl) && (
                      <p className={locationIsLink ? PLACE_URL : PLACE_WORDS}>
                        <span className={PLACE_LABEL}>{pd.intLocation}:</span> {iv.location}
                      </p>
                    )}
                  </div>
                  <EvalChip icon={STATUS_ICON[iv.status] ?? <CalendarClock aria-hidden="true" />}>
                    {statusLabel(iv.status)}
                  </EvalChip>
                </div>

                {viaEmail && (
                  <EvalCallout tone="info" icon={<Mail aria-hidden="true" />} className={VIA_EMAIL}>
                    {pd.intJoinViaEmail}
                  </EvalCallout>
                )}
                {joinUrl && (
                  <a href={joinUrl} target="_blank" rel="noopener noreferrer" className={JOIN_LINK}>
                    {pd.intJoin}
                    <ExternalLink aria-hidden="true" />
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
