import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
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
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
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
        })
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
