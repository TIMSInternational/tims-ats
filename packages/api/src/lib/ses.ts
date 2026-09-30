import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { logger } from '@tims/shared';
import { sesCircuit, sesRawCircuit } from './circuit-breaker';

const ses = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

const FROM_ADDRESS = process.env.PLATFORM_EMAIL_FROM || 'noreply@nexadev.ai';

interface SendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  abortSignal?: AbortSignal;
}

export async function sendEmail({ to, subject, html, abortSignal }: SendEmailParams): Promise<boolean> {
  const destinations = Array.isArray(to) ? to : [to];

  try {
    return await sesCircuit.execute(async () => {
      await ses.send(
        new SendEmailCommand({
          Source: FROM_ADDRESS,
          Destination: { ToAddresses: destinations },
          Message: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Html: { Data: html, Charset: 'UTF-8' } },
          },
        }),
        { abortSignal },
      );
      return true;
    }, () => {
      logger.warn({ component: 'ses' }, 'Circuit breaker open — email not sent');
      return false;
    });
  } catch (error) {
    logger.error(
      { component: 'ses', errMessage: error instanceof Error ? error.message : String(error) },
      'Failed to send email',
    );
    return false;
  }
}

export type SendRawEmailResult =
  | { sent: true }
  | {
      sent: false;
      errorName: string;
      /**
       * `denied`: the IAM role lacks ses:SendRawEmail (a configuration fact, not an outage);
       * `circuit_open`: raw sends are paused after repeated transient failures;
       * `error`: this one send failed (it may or may not have been accepted — do not blindly resend).
       */
      reason: 'denied' | 'circuit_open' | 'error';
    };

/** How long a raw-send permission denial is remembered before SES is asked again (picks up a new grant). */
export const RAW_DENIED_CACHE_MS = 10 * 60_000;
let rawDeniedUntil = 0;

export function isSesPermissionDenied(errorName: string): boolean {
  return /AccessDenied|NotAuthorized/i.test(errorName);
}

/**
 * Sends a pre-built RFC 5322 MIME message (see lib/mime.ts) — used only for mail
 * with attachments (interview .ics). Requires the `ses:SendRawEmail` IAM action.
 * Never throws; returns the SDK error NAME (no message — it can echo addresses)
 * so callers can decide whether to fall back to plain sendEmail.
 *
 * Runs in its own breaker (sesRawCircuit), never the shared sesCircuit. A permission denial is NOT a
 * breaker failure: it is cached per instance for RAW_DENIED_CACHE_MS and answered without calling SES,
 * so a role without ses:SendRawEmail costs one AccessDenied per instance per window, not one per email.
 */
export async function sendRawEmail({ to, raw, abortSignal }: { to: string; raw: string; abortSignal?: AbortSignal }): Promise<SendRawEmailResult> {
  if (Date.now() < rawDeniedUntil) return { sent: false, errorName: 'AccessDenied', reason: 'denied' };
  try {
    return await sesRawCircuit.execute<SendRawEmailResult>(async () => {
      try {
        await ses.send(
          new SendRawEmailCommand({
            Source: FROM_ADDRESS,
            Destinations: [to],
            RawMessage: { Data: new TextEncoder().encode(raw) },
          }),
          { abortSignal },
        );
        return { sent: true };
      } catch (error) {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        if (!isSesPermissionDenied(errorName)) throw error; // transient: counts against the raw breaker
        rawDeniedUntil = Date.now() + RAW_DENIED_CACHE_MS;
        logger.warn({ component: 'ses', errName: errorName }, 'ses:SendRawEmail denied — using plain email without .ics');
        return { sent: false, errorName, reason: 'denied' };
      }
    }, () => {
      logger.warn({ component: 'ses' }, 'Raw-email circuit breaker open — raw email not sent');
      return { sent: false, errorName: 'CircuitOpen', reason: 'circuit_open' };
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.error({ component: 'ses', errName: errorName }, 'Failed to send raw email');
    return { sent: false, errorName, reason: 'error' };
  }
}

export function getEmailFromAddress(): string {
  return FROM_ADDRESS;
}
