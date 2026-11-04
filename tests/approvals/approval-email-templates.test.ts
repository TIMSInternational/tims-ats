import { describe, expect, it } from 'vitest';
import {
  approvalEmailLocale,
  renderApprovalRequestEmail,
  type ApprovalRequestEmailInput,
} from '../../packages/api/src/services/approval-email-templates';

// Pilot UX audit B-01: the approver email. Staff-facing Spanish ("tú"), English for en users, a deep
// link to the item, and every dynamic value escaped (candidate names come from the public apply form).

const BASE: ApprovalRequestEmailInput = {
  kind: 'vacancy',
  locale: 'es',
  approverFirstName: 'Ana',
  requesterName: 'Rita Reclutadora',
  companyName: 'Empresa Piloto',
  vacancyTitle: 'Analista de Datos',
  reviewUrl: 'https://app.example.test/recruitment/vacancies/v1',
};

describe('approval request email', () => {
  it('vacancy (es): names the vacancy, the requester and links to it', () => {
    const { subject, html } = renderApprovalRequestEmail(BASE);
    expect(subject).toBe('Aprobación pendiente: vacante Analista de Datos');
    expect(html).toContain('Hola Ana,');
    expect(html).toContain('Rita Reclutadora te pidió aprobar la vacante <strong>Analista de Datos</strong>');
    expect(html).toContain('href="https://app.example.test/recruitment/vacancies/v1"');
    expect(html).toContain('Revisar la vacante');
    expect(html).toContain('lang="es"');
  });

  it('offer (es): names the candidate and the vacancy, and says it cannot be sent yet', () => {
    const { subject, html } = renderApprovalRequestEmail({
      ...BASE,
      kind: 'offer',
      candidateName: 'María Pérez',
      reviewUrl: 'https://app.example.test/recruitment/offers?offer=o1',
    });
    expect(subject).toBe('Aprobación pendiente: oferta para María Pérez (Analista de Datos)');
    expect(html).toContain('la oferta para <strong>María Pérez</strong>');
    expect(html).toContain('href="https://app.example.test/recruitment/offers?offer=o1"');
    expect(html).toContain('no se puede enviar al candidato hasta que la apruebes');
  });

  it('en: English copy for an English-locale approver', () => {
    const { subject, html } = renderApprovalRequestEmail({ ...BASE, locale: 'en' });
    expect(subject).toBe('Approval needed: vacancy Analista de Datos');
    expect(html).toContain('Hi Ana,');
    expect(html).toContain('Review the vacancy');
    expect(html).toContain('lang="en"');
  });

  it('escapes every dynamic value and strips line breaks from the subject', () => {
    const { subject, html } = renderApprovalRequestEmail({
      ...BASE,
      kind: 'offer',
      approverFirstName: '<b>Ana</b>',
      requesterName: 'Rita <script>alert(1)</script>',
      vacancyTitle: 'Dev\r\nBcc: victim@example.test',
      candidateName: '<img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>Ana</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(subject).not.toMatch(/[\r\n]/);
  });

  it('refuses a non-http review link', () => {
    const { html } = renderApprovalRequestEmail({ ...BASE, reviewUrl: 'javascript:alert(1)' });
    expect(html).not.toContain('javascript:');
    expect(html).toContain('href="#"');
  });

  it('falls back to a generic greeting and requester when names are missing', () => {
    const { html } = renderApprovalRequestEmail({ ...BASE, approverFirstName: ' ', requesterName: '' });
    expect(html).toContain('Hola,');
    expect(html).toContain('Tu equipo de reclutamiento te pidió aprobar');
  });

  it('maps user locales: en* is English, everything else Spanish', () => {
    expect(approvalEmailLocale('en')).toBe('en');
    expect(approvalEmailLocale('en-US')).toBe('en');
    expect(approvalEmailLocale('es-CR')).toBe('es');
    expect(approvalEmailLocale(null)).toBe('es');
  });
});
