import { describe, expect, it } from 'vitest';
import {
  renderInterviewEmail,
  type InterviewEmailInput,
} from '../../packages/api/src/services/interview-email-templates';
import { emailTemplates } from '../../packages/api/src/services/email-templates.service';

const base: InterviewEmailInput = {
  kind: 'invite',
  audience: 'candidate',
  locale: 'es',
  timeZone: 'America/Bogota',
  recipientName: '<script>alert(1)</script>',
  candidateName: '<script>alert(1)</script>',
  vacancyTitle: 'Analista & "Datos"',
  companyName: 'Acme',
  interviewType: 'video',
  scheduledAt: new Date('2026-10-01T15:00:00Z'),
  duration: 60,
  joinUrl: 'https://ats.example.test/interview/join/tok',
  contactEmail: 'hr@acme.test',
};

describe('interview email templates', () => {
  it('HTML-escapes user data and never shows a raw type slug', () => {
    const { html, text } = renderInterviewEmail(base);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Analista &amp; &quot;Datos&quot;');
    expect(html).toContain('Videoconferencia');
    expect(html).toContain('10:00'); // 15:00Z rendered in America/Bogota
    expect(text).toContain('https://ats.example.test/interview/join/tok');
  });

  it('localizes to English and labels unknown types generically', () => {
    const { html, subject } = renderInterviewEmail({
      ...base,
      locale: 'en',
      interviewType: 'weird_type',
      joinUrl: null,
    });
    expect(subject.startsWith('Interview invitation')).toBe(true);
    expect(html).toContain('>Interview<');
    expect(html).not.toContain('weird_type');
  });

  it('gives phone candidates a phone note instead of a link', () => {
    const { html } = renderInterviewEmail({ ...base, interviewType: 'phone', joinUrl: null });
    expect(html).toContain('Telefónica');
    expect(html).toContain('teléfono');
    expect(html).not.toContain('/interview/join/');
  });

  it('application-received confirmation is escaped and localized', () => {
    const es = emailTemplates.applicationReceived({
      candidateName: '<b>Ana</b>',
      vacancyTitle: 'Dev\r\nBcc: x',
      companyName: 'Acme',
      locale: 'es',
    });
    // Markup is not a plain name → generic greeting; the value never reaches the HTML at all.
    expect(es.html).toContain('Estimado/a candidato/a,');
    expect(es.html).not.toContain('Ana');
    expect(es.subject).not.toMatch(/[\r\n]/);
    expect(es.subject.startsWith('Aplicación recibida')).toBe(true);
    const en = emailTemplates.applicationReceived({
      candidateName: 'Ana',
      vacancyTitle: 'Dev',
      companyName: 'Acme',
      locale: 'en',
    });
    expect(en.subject).toBe('Application received — Dev');
    expect(en.html).toContain('lang="en"');
  });

  // #308 security fix: the apply form is unauthenticated and chooses the recipient, so the
  // greeting only ever carries a plain personal name — never a URL, domain, digits or markup.
  it('application-received greeting keeps real (accented) names and drops hostile ones', () => {
    const greet = (candidateName: string, locale: 'es' | 'en' = 'es') =>
      emailTemplates.applicationReceived({ candidateName, vacancyTitle: 'Dev', companyName: 'Acme', locale }).html;

    for (const real of ['José', 'María-José', "O'Brien", 'Ana María', 'J. Pérez', 'Zoë', 'Nguyễn']) {
      expect(greet(real)).toContain(`Estimado/a ${real.replace(/'/g, '&#39;')},`);
    }
    expect(greet('Ana', 'en')).toContain('Dear Ana,');

    const hostile = [
      'Visit https://evil.example to claim',
      'evil.com',
      'Call 555 0100',
      'Ana<script>',
      'Win $1000',
      'Ana/verify',
      ' ',
      '',
      'A'.repeat(51),
      'Ana\nBcc: x',
    ];
    for (const bad of hostile) {
      const html = greet(bad);
      expect(html).toContain('Estimado/a candidato/a,');
      if (bad.trim()) expect(html).not.toContain(bad.trim().slice(0, 12));
    }
    expect(greet('evil.com', 'en')).toContain('Dear candidate,');
  });
});
