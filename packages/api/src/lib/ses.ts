import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { logger } from '@tims/shared';
import { sesCircuit } from './circuit-breaker';

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

export type SendRawEmailResult = { sent: true } | { sent: false; errorName: string };

/**
 * Sends a pre-built RFC 5322 MIME message (see lib/mime.ts) — used only for mail
 * with attachments (interview .ics). Requires the `ses:SendRawEmail` IAM action.
 * Never throws; returns the SDK error NAME (no message — it can echo addresses)
 * so callers can decide whether to fall back to plain sendEmail.
 */
export async function sendRawEmail({ to, raw, abortSignal }: { to: string; raw: string; abortSignal?: AbortSignal }): Promise<SendRawEmailResult> {
  try {
    return await sesCircuit.execute<SendRawEmailResult>(async () => {
      await ses.send(
        new SendRawEmailCommand({
          Source: FROM_ADDRESS,
          Destinations: [to],
          RawMessage: { Data: new TextEncoder().encode(raw) },
        }),
        { abortSignal },
      );
      return { sent: true };
    }, () => {
      logger.warn({ component: 'ses' }, 'Circuit breaker open — raw email not sent');
      return { sent: false, errorName: 'CircuitOpen' };
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'UnknownError';
    logger.error({ component: 'ses', errName: errorName }, 'Failed to send raw email');
    return { sent: false, errorName };
  }
}

export function getEmailFromAddress(): string {
  return FROM_ADDRESS;
}
