// One-off script to send all 6 email template previews to a given address
// Usage: npx tsx scripts/send-email-previews.ts <email>
// Run from repo root: cd packages/api && npx tsx scripts/send-email-previews.ts fedetafur3@gmail.com

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { emailTemplates } from '../src/services/email-templates.service';

// Uses ~/.aws/credentials (default chain) — do NOT load .env here
// The .env has different AWS credentials for a different account

const to = process.argv[2];
if (!to) {
  console.error('Usage: npx tsx scripts/send-email-previews.ts <email>');
  process.exit(1);
}

// Use default credential chain (~/.aws/credentials) — nexadev.ai verified in us-east-1
const ses = new SESClient({ region: 'us-east-1' });

// In SES sandbox, sender must be verified — override with recipient if needed
const from = process.argv[3] || process.env.AWS_SES_FROM_EMAIL || process.env.PLATFORM_EMAIL_FROM || 'noreply@nexadev.ai';
const company = 'TIMS International';
const candidate = 'Maria Fernanda Lopez';
const vacancy = 'Gerente de Operaciones';
const date = new Date(2026, 5, 10, 10, 0);
const contact = 'rrhh@timsinternational.com';

const previews = [
  emailTemplates.interviewInvitation({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    interviewType: 'Entrevista tecnica', scheduledAt: date, duration: 60,
    meetingUrl: 'https://meet.daily.co/tims-interview-abc123', contactEmail: contact,
  }),
  emailTemplates.interviewReschedule({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    interviewType: 'Entrevista tecnica', scheduledAt: date, duration: 60,
    meetingUrl: 'https://meet.daily.co/tims-interview-abc123', contactEmail: contact,
    oldScheduledAt: new Date(2026, 5, 8, 14, 0), newScheduledAt: date,
  }),
  emailTemplates.interviewCancellation({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    cancelReason: 'La posicion ha sido cubierta internamente', contactEmail: contact,
  }),
  emailTemplates.offerSent({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    signingUrl: 'https://app.tims.co/offers/sign/abc-123-demo',
  }),
  emailTemplates.offerAcceptedNotification({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    acceptedAt: date, recipientName: 'Equipo de RRHH',
  }),
  emailTemplates.offerDeclinedNotification({
    candidateName: candidate, vacancyTitle: vacancy, companyName: company,
    declinedAt: date, recipientName: 'Equipo de RRHH',
  }),
];

async function send() {
  console.log(`Sending 6 email previews to ${to} from ${from}...`);
  for (const { subject, html } of previews) {
    const label = `[PREVIEW] ${subject}`;
    try {
      await ses.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: label, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' } },
        },
      }));
      console.log(`  OK: ${label}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAIL: ${label} — ${msg}`);
    }
  }
  console.log('Done.');
}

send();
