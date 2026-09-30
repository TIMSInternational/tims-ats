// ---------------------------------------------------------------------------
// Interview invitation / update / cancellation delivery (candidate + evaluators)
// ---------------------------------------------------------------------------
// Each recipient gets their OWN email + .ics (their own ATTENDEE line, same UID
// per interview, SEQUENCE from updatedAt). The candidate's email carries the
// public join link (video); evaluators get the STAFF room link and never see the
// candidate token. notify() NEVER throws — callers fire-and-forget it, and the
// tRPC mutation must not fail because mail did. Logs carry no PII and no token.

import { getAppUrl, logger } from '@tims/shared';
import { buildIcs, sequenceFromUpdatedAt, type IcsMethod } from '../lib/ics';
import { buildMimeMessage } from '../lib/mime';
import { getEmailFromAddress, sendEmail, sendRawEmail } from '../lib/ses';
import { interviewEmailRepository, type InterviewNotificationData } from '../repositories/interview-email.repository';
import { candidateJoinApplies, candidateJoinUrl, staffRoomUrl } from './interview-join-token';
import {
  interviewTypeLabel,
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
};

export type InterviewEmailMessage = {
  audience: 'candidate' | 'evaluator';
  to: string;
  subject: string;
  html: string;
  text: string;
  ics: string;
  method: IcsMethod;
};

const DEFAULT_CONTACT = 'rrhh@timsinternational.com';
const DEFAULT_TZ = 'America/Bogota';
const SEND_TIMEOUT_MS = 8_000;

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
  const contactEmail = org.billingEmail ?? DEFAULT_CONTACT;
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
    timeZone: string,
    joinUrl: string | null,
  ): void => {
    // One malformed address must not suppress everyone else's email.
    try {
      const rendered = renderInterviewEmail({
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
        oldScheduledAt: params.oldScheduledAt ?? null,
        cancelReason: interview.cancelReason,
        contactEmail,
      });
      const typeLabel = interviewTypeLabel(interview.type, locale);
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
        location: cancel ? undefined : (joinUrl ?? interview.location ?? meetingUrl ?? undefined),
        url: cancel ? undefined : (joinUrl ?? undefined),
        organizer,
        attendees: [to],
      });
      messages.push({ audience, to: to.email, ...rendered, ics, method });
    } catch {
      skipped += 1; // invalid recipient data; counted and logged (no PII) by notify()
    }
  };

  if (interview.candidate.email) {
    const joinUrl =
      !cancel && joinApplies && params.candidateJoinToken ? candidateJoinUrl(appUrl, params.candidateJoinToken) : null;
    build(
      'candidate',
      { name: candidateName, email: interview.candidate.email },
      toLocale(interview.vacancy.company?.language),
      interview.vacancy.company?.timezone ?? DEFAULT_TZ,
      joinUrl,
    );
  }
  const roomUrl = !cancel && joinApplies ? staffRoomUrl(appUrl, interview.id) : null;
  for (const { user } of interview.evaluators) {
    if (!user.isActive || !user.email) continue;
    build(
      'evaluator',
      { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email },
      toLocale(user.locale),
      user.timezone || DEFAULT_TZ,
      roomUrl,
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
    messageIdDomain: appHost(appUrl),
  });
  const result = await sendRawEmail({ to: message.to, raw, abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
  if (result.sent) return true;
  if (result.reason === 'denied' || result.reason === 'circuit_open') {
    return sendEmail({
      to: message.to,
      subject: message.subject,
      html: message.html,
      abortSignal: AbortSignal.timeout(SEND_TIMEOUT_MS),
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
