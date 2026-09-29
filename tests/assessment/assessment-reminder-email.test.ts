import { describe, expect, it, vi } from 'vitest';

vi.mock('../../packages/api/src/lib/ses', () => ({ sendEmail: vi.fn() }));

import { sendEmail } from '../../packages/api/src/lib/ses';
import { emailService } from '../../packages/api/src/services/email.service';
import { emailTemplates } from '../../packages/api/src/services/email-templates.service';

const reminder = {
  candidateEmail: 'ana@example.com',
  candidateName: 'Ana',
  assessmentName: 'Cognitive Battery',
  companyName: 'TIMS International',
  assessmentUrl: 'https://tims-ats.vercel.app/careers/tims/dashboard',
  expiresAt: null,
};

describe('assessment reminder email', () => {
  it('passes a bounded provider request and returns its acceptance result', async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(emailService.sendAssessmentReminder(reminder)).resolves.toBe(true);
    await expect(emailService.sendAssessmentReminder(reminder)).resolves.toBe(false);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ana@example.com',
      subject: expect.stringContaining('Cognitive Battery'),
      html: expect.stringContaining(reminder.assessmentUrl),
      abortSignal: expect.any(AbortSignal),
    }));
  });

  it('escapes candidate-supplied text and rejects unsafe links in HTML', () => {
    const { html } = emailTemplates.assessmentReminder({
      ...reminder,
      candidateName: '<img src=x onerror=alert(1)>',
      assessmentUrl: 'javascript:alert(1)',
    });
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="#"');
  });
});
