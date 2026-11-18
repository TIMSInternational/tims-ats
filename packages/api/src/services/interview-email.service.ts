// ---------------------------------------------------------------------------
// Interview invitation / update / cancellation delivery (candidate + evaluators)
// ---------------------------------------------------------------------------
// Each recipient gets their OWN email + .ics (their own ATTENDEE line, same UID
// per interview, SEQUENCE from updatedAt). The candidate's email carries the
// public join link (video); evaluators get the STAFF room link and never see the
// candidate token. notify() NEVER throws — callers fire-and-forget it, and the
// tRPC mutation must not fail because mail did. Logs carry no PII and no token.
// Candidate copies reply to the organization's candidate contact (services/candidate-contact.ts).

import { getAppUrl, logger, orgSettingsTimeZone, resolveInterviewTimeZone } from '@tims/shared';
import { buildIcs, sequenceFromUpdatedAt, type IcsMethod } from '../lib/ics';
import { buildMimeMessage } from '../lib/mime';
import { getEmailFromAddress, sendEmail, sendRawEmail } from '../lib/ses';
import { interviewEmailRepository, type InterviewNotificationData } from '../repositories/interview-email.repository';
import { candidateContactEmail } from './candidate-contact';
import { candidateJoinApplies, candidateJoinUrl, staffRoomUrl } from './interview-join-token';
import {
  interviewModeLabel,
  renderInterviewEmail,
  type EmailLocale,
  type InterviewEmailKind,
} from './interview-email-templates';

export type InterviewNotifyParams = {
  orgId: string;
  interviewId: string;
  kind: InterviewEmailKind;
  /** Plaintext join token minted by THIS write (video create/reschedule). Never logged. */
  candidateJoinToken?: string | null;
  oldScheduledAt?: Date | null;
  /** Mail ONLY this panel member (an evaluator added to an existing interview); nobody else is notified. */
  onlyEvaluatorId?: string;
};

export type InterviewEmailMessage = {
  audience: 'candidate' | 'evaluator';
  to: string;
  subject: string;
  html: string;
  /** The same email without the "we attach a calendar invitation" line, for the plain (no .ics) fallback. */
  fallbackHtml: string;
  text: string;
  ics: string;
  method: IcsMethod;
  /** Candidate copies: the organization's candidate contact, when it has one. */
  replyTo: string | null;
};

const SEND_TIMEOUT_MS = 8_000;
/** Interviews that will not take place: only their cancellation is ever mailed. */
const NOT_HAPPENING_STATUSES: ReadonlySet<string> = new Set(['cancelled', 'no_show']);

/**
 * The tenant's configured timezone (`organizations.settings.timezone`), or null when unset or invalid.
 * Interviews are local events: every recipient's email shows the time in the organization's zone, else
 * the vacancy company's, else UTC (labelled as such). `users.timezone` is NOT used: it defaults to the
 * column default for everyone, so it cannot be trusted to carry the tenant's real zone.
 */
export function orgTimeZone(settings: unknown): string | null {
  return orgSettingsTimeZone(settings);
}

function toLocale(value: string | null | undefined): EmailLocale {
  return value?.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/** Bare mailbox of the configured sender ("Name <a@b>" → "a@b"). */
export function senderMailbox(from: string): string {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

function appHost(appUrl: string): string {
  try {
    return new URL(appUrl).hostname || 'tims-ats';
  } catch {
    return 'tims-ats';
  }
}

/**
 * Pure: builds every recipient's message for one interview event. `skipped` counts recipients whose
 * message could not be built (malformed data) — they are not in `messages`.
 */
export function buildInterviewEmails(
  data: InterviewNotificationData,
  params: InterviewNotifyParams,
  appUrl: string,
  now: Date = new Date(),
): { messages: InterviewEmailMessage[]; skipped: number } {
  const { interview, org } = data;
  const cancel = params.kind === 'cancel';
  // A late invite/update for an interview that was cancelled meanwhile must not go out.
  if (!cancel && NOT_HAPPENING_STATUSES.has(interview.status)) return { messages: [], skipped: 0 };
  const method: IcsMethod = cancel ? 'CANCEL' : 'REQUEST';
  // Tokenized join only for our own Daily room (or none yet). An external meetingUrl (Zoom/Meet/…) is sent
  // as-is to everyone; our own private Daily room URL is never sent (it is dead without a meeting token).
  const joinApplies = candidateJoinApplies(interview.type, {
    meetingUrl: interview.meetingUrl,
    interviewId: interview.id,
  });
  const meetingUrl = joinApplies ? null : interview.meetingUrl;
  const candidateName = `${interview.candidate.firstName} ${interview.candidate.lastName}`.trim();
  const vacancyTitle = interview.vacancy.title;
  const contactEmail = candidateContactEmail(org);
  const timeZone = resolveInterviewTimeZone(orgTimeZone(org.settings), interview.vacancy.company?.timezone);
  const organizer = { name: org.name, email: senderMailbox(getEmailFromAddress()) };
  const end = new Date(interview.scheduledAt.getTime() + interview.duration * 60_000);
  const uid = `interview-${interview.id}@${appHost(appUrl)}`;
  const sequence = sequenceFromUpdatedAt(interview.updatedAt);
  const messages: InterviewEmailMessage[] = [];
  let skipped = 0;

  const build = (
    audience: 'candidate' | 'evaluator',
    to: { name: string; email: string },
    locale: EmailLocale,
    joinUrl: string | null,
    scorecardUrl: string | null = null,
  ): void => {
    // One malformed address must not suppress everyone else's email.
    try {
      const input = {
        kind: params.kind,
        audience,
        locale,
        timeZone,
        recipientName: to.name,
        candidateName,
        vacancyTitle,
        companyName: org.name,
        interviewType: interview.type,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        location: interview.location,
        meetingUrl,
        joinUrl,
        scorecardUrl,
        oldScheduledAt: params.oldScheduledAt ?? null,
        cancelReason: interview.cancelReason,
        contactEmail,
      };
      const rendered = renderInterviewEmail(input);
      const fallbackHtml = renderInterviewEmail({ ...input, hasCalendarAttachment: false }).html;
      const typeLabel = interviewModeLabel(interview.type, joinUrl ? null : meetingUrl, locale);
      const summary =
        audience === 'candidate'
          ? `${typeLabel}: ${vacancyTitle} — ${org.name}`
          : `${typeLabel}: ${candidateName} — ${vacancyTitle}`;
      const ics = buildIcs({
        method,
        uid,
        sequence,
        start: interview.scheduledAt,
        end,
        stamp: now,
        summary,
        description: rendered.text,
        location: cancel ? undefined : (joinUrl ?? meetingUrl ?? interview.location ?? undefined),
        url: cancel ? undefined : (joinUrl ?? meetingUrl ?? undefined),
        organizer,
        attendees: [to],
      });
      messages.push({
        audience,
        to: to.email,
        ...rendered,
        fallbackHtml,
        ics,
        method,
        replyTo: audience === 'candidate' ? contactEmail : null,
      });
    } catch {
      skipped += 1; // invalid recipient data; counted and logged (no PII) by notify()
    }
  };

  const onlyEvaluator = params.onlyEvaluatorId ?? null;
  if (!onlyEvaluator && interview.candidate.email && !data.candidateConsentWithdrawn) {
    const joinUrl =
      !cancel && joinApplies && params.candidateJoinToken ? candidateJoinUrl(appUrl, params.candidateJoinToken) : null;
    build(
      'candidate',
      { name: candidateName, email: interview.candidate.email },
      toLocale(data.candidateLocale ?? interview.vacancy.company?.language),
      joinUrl,
    );
  }
  // Video: the room link IS the place to join and score. Every other type: the same room URL opens
  // straight on the scorecard, so panelists always learn where to score.
  const roomUrl = !cancel ? staffRoomUrl(appUrl, interview.id) : null;
  for (const { user } of interview.evaluators) {
    if (!user.isActive || !user.email) continue;
    if (onlyEvaluator && user.id !== onlyEvaluator) continue;
    build(
      'evaluator',
      { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email },
      toLocale(user.locale),
      joinApplies ? roomUrl : null,
      joinApplies ? null : roomUrl,
    );
  }
  return { messages, skipped };
}

/**
 * Raw (MIME + .ics) send. Falls back to the plain HTML email (no .ics) when the IAM role lacks
 * ses:SendRawEmail or raw sends are paused by their own breaker — never on a single failed raw send,
 * which SES may already have accepted (a fallback there could deliver the invitation twice).
 */
async function deliver(message: InterviewEmailMessage, appUrl: string): Promise<boolean> {
  const raw = buildMimeMessage({
    from: getEmailFromAddress(),
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    calendar: {
      method: message.method,
      filename: message.method === 'CANCEL' ? 'cancel.ics' : 'invite.ics',
      content: message.ics,
    },
    replyTo: message.replyTo,
    messageIdDomain: appHost(appUrl),
  });
  const result = await sendRawEmail({ to: message.to, raw, abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  if (result.sent) return true;
  if (result.reason === 'denied' || result.reason === 'circuit_open') {
    return sendEmail({
      to: message.to,
      subject: message.subject,
      html: message.fallbackHtml,
      abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      replyTo: message.replyTo,
    });
  }
  return false;
}

export const interviewEmailService = {
  async notify(params: InterviewNotifyParams): Promise<void> {
    try {
      const data = await interviewEmailRepository.findForNotification(params.orgId, params.interviewId);
      if (!data) return;
      const appUrl = getAppUrl();
      const { messages, skipped } = buildInterviewEmails(data, params, appUrl);
      const results = await Promise.allSettled(messages.map((m) => deliver(m, appUrl)));
      const failed = results.filter((r) => r.status === 'rejected' || !r.value).length;
      if (skipped > 0) {
        logger.warn(
          { component: 'interview-email', interviewId: params.interviewId, kind: params.kind, skipped },
          'Some interview email recipients were skipped (message could not be built)',
        );
      }
      if (failed > 0) {
        logger.warn(
          {
            component: 'interview-email',
            interviewId: params.interviewId,
            kind: params.kind,
            failed,
            total: messages.length,
          },
          'Some interview emails were not sent',
        );
      }
    } catch (error) {
      logger.error(
        {
          component: 'interview-email',
          interviewId: params.interviewId,
          kind: params.kind,
          errName: error instanceof Error ? error.name : 'UnknownError',
        },
        'Interview email notification failed',
      );
    }
  },
};
