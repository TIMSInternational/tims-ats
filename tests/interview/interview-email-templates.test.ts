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
    // Candidate copy says "postulación" and "usted" (pilot product decision).
    expect(es.subject.startsWith('Postulación recibida')).toBe(true);
    expect(es.html).toContain('Hemos recibido su postulación');
    expect(es.html).toContain('Gracias por postularse');
    expect(es.html).not.toMatch(/aplicaci[oó]n|aplicar/i);
    // Without a portal URL there is no portal button.
    expect(es.html).not.toContain('Ver mis postulaciones');
    const en = emailTemplates.applicationReceived({
      candidateName: 'Ana',
      vacancyTitle: 'Dev',
      companyName: 'Acme',
      locale: 'en',
    });
    expect(en.subject).toBe('Application received — Dev');
    expect(en.html).toContain('lang="en"');
  });

  it('application-received confirmation links the candidate portal when a portal URL is given (guarded)', () => {
    const withPortal = emailTemplates.applicationReceived({
      candidateName: 'Ana',
      vacancyTitle: 'Dev',
      companyName: 'Acme',
      locale: 'es',
      portalUrl: 'https://app.example.com/careers/acme/dashboard',
    });
    expect(withPortal.html).toContain('href="https://app.example.com/careers/acme/dashboard"');
    expect(withPortal.html).toContain('Ver mis postulaciones');
    expect(withPortal.html).toContain('ingresando con este mismo correo electrónico');
    // A non-http(s) URL never reaches an href.
    const hostile = emailTemplates.applicationReceived({
      candidateName: 'Ana',
      vacancyTitle: 'Dev',
      companyName: 'Acme',
      locale: 'en',
      portalUrl: 'javascript:alert(1)',
    });
    expect(hostile.html).not.toContain('javascript:');
    expect(hostile.html).toContain('View my applications');
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

  it('application-received names the organization contact only when it has one', () => {
    const withContact = emailTemplates.applicationReceived({
      candidateName: 'Ana',
      vacancyTitle: 'Dev',
      companyName: 'Acme',
      locale: 'es',
      contactEmail: 'reclutamiento@acme.test',
    });
    expect(withContact.html).toContain('Si tiene preguntas, escríbanos a');
    expect(withContact.html).toContain('mailto:reclutamiento@acme.test');
    const without = emailTemplates.applicationReceived({ candidateName: 'Ana', vacancyTitle: 'Dev', companyName: 'Acme', locale: 'es' });
    expect(without.html).not.toContain('mailto:');
    expect(without.html).not.toContain('timsinternational');
  });
});

describe('interview email templates — pilot honesty (C-02, C-21, C-22, C-36, B-06)', () => {
  const teams = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc/0?context=x';
  const pasted: InterviewEmailInput = {
    ...base,
    recipientName: 'Ana',
    candidateName: 'Ana Mora',
    vacancyTitle: 'Analista',
    timeZone: 'America/Costa_Rica',
    scheduledAt: new Date('2026-11-10T16:00:00Z'),
    interviewType: 'onsite',
    joinUrl: null,
    location: teams,
    meetingUrl: teams,
  };

  it('a pasted Teams link is an online interview: "En línea", the link once, and a join button', () => {
    const { html, text } = renderInterviewEmail(pasted);
    expect(html).toContain('En línea');
    expect(html).not.toContain('Presencial');
    expect(html).not.toContain('>Lugar<');
    expect(html.split(teams.replace(/&/g, '&amp;')).length - 1).toBeGreaterThanOrEqual(1);
    expect(html).toContain('Unirse a la reunión');
    expect(text).toContain(`Unirse a la reunión: ${teams}`);
    expect(text).not.toMatch(/^Lugar:/m);
  });

  it('a content type with a link keeps its name and says it is online', () => {
    const { html } = renderInterviewEmail({ ...pasted, interviewType: 'technical' });
    expect(html).toContain('Técnica (en línea)');
  });

  it('a real place is still shown as the place', () => {
    const { html } = renderInterviewEmail({ ...pasted, location: 'Oficinas centrales, San José', meetingUrl: null });
    expect(html).toContain('Presencial');
    expect(html).toContain('Oficinas centrales, San José');
    expect(html).not.toContain('Unirse a la reunión');
  });

  it('prints the time with the organization zone label, never GMT-only or Bogotá', () => {
    const { html } = renderInterviewEmail(pasted);
    expect(html).toContain('10:00');
    expect(html).toContain('hora de Costa Rica (GMT-6)');
    const en = renderInterviewEmail({ ...pasted, locale: 'en' });
    expect(en.html).toContain('Costa Rica time (GMT-6)');
    const broken = renderInterviewEmail({ ...pasted, timeZone: 'Mars/Olympus' });
    expect(broken.html).toContain('4:00');
    expect(broken.html).toContain('(UTC)');
  });

  it('omits the contact line when the organization has no candidate contact', () => {
    const { html, text } = renderInterviewEmail({ ...pasted, contactEmail: null });
    expect(html).not.toContain('mailto:');
    expect(text).not.toContain('Si tiene preguntas');
  });

  it('the plain fallback copy does not claim a calendar attachment', () => {
    expect(renderInterviewEmail(pasted).html).toContain('.ics');
    const plain = renderInterviewEmail({ ...pasted, hasCalendarAttachment: false });
    expect(plain.html).not.toContain('.ics');
    expect(plain.text).not.toContain('.ics');
  });

  it('a cancellation tells the candidate what happens next', () => {
    const { html } = renderInterviewEmail({ ...pasted, kind: 'cancel', cancelReason: 'Cambio de agenda' });
    expect(html).toContain('Cambio de agenda');
    expect(html).toContain('recibirá una nueva invitación');
    expect(html).not.toContain('Unirse a la reunión');
  });

  it('evaluators of a non-video interview get the TIMS scorecard link', () => {
    const scorecardUrl = 'https://ats.example.test/recruitment/interviews/iv1/room';
    const { html, text } = renderInterviewEmail({
      ...pasted,
      audience: 'evaluator',
      recipientName: 'Eva',
      scorecardUrl,
    });
    expect(html).toContain('Abrir ficha de evaluación');
    expect(html).toContain(scorecardUrl);
    expect(text).toContain(`Abrir ficha de evaluación: ${scorecardUrl}`);
    expect(html).toContain('Unirse a la reunión');
    // Never on a cancellation.
    const cancel = renderInterviewEmail({ ...pasted, audience: 'evaluator', kind: 'cancel', scorecardUrl });
    expect(cancel.html).not.toContain('Abrir ficha de evaluación');
  });
});
