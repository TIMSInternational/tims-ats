import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

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
  } catch (error) {
    console.error('[SES] Failed to send email:', error);
    return false;
  }
}
