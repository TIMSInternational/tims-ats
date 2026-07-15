import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const WIDGET = read('apps/web/app/(portal)/careers/[orgSlug]/me/me-faq-chat.tsx');
const SHELL = read('apps/web/app/(portal)/careers/[orgSlug]/me/me-shell.tsx');
const EN = JSON.parse(read('apps/web/lib/i18n/en.json'));
const ES = JSON.parse(read('apps/web/lib/i18n/es.json'));

describe('candidate FAQ portal UI', () => {
  it('wires the widget to candidatePortal.askFaq and never sends candidate identity', () => {
    expect(WIDGET).toContain('trpc.candidatePortal.askFaq.useMutation');
    expect(WIDGET).toContain('{ orgSlug, question: trimmed }');
    expect(WIDGET).not.toMatch(/candidateId|email/);
  });

  it('renders inside the authenticated candidate dashboard shell', () => {
    expect(SHELL).toContain("import { MeFaqChat } from './me-faq-chat'");
    expect(SHELL).toContain('<MeFaqChat orgSlug={orgSlug} />');
  });

  it('has both locale dictionaries for every candidate FAQ label', () => {
    const keys = [
      'faqTitle',
      'faqSubtitle',
      'faqSuggestionStatus',
      'faqSuggestionInterview',
      'faqSuggestionOffer',
      'faqPlaceholder',
      'faqInputLabel',
      'faqPrivacy',
      'faqSend',
      'faqSending',
      'faqError',
      'faqYouLabel',
      'faqAssistantLabel',
      'faqSources',
      'faqSourceProfile',
      'faqSourceApplications',
      'faqSourceInterviews',
      'faqSourceOffers',
    ];

    for (const key of keys) {
      expect(EN.portalMe[key]).toBeTruthy();
      expect(ES.portalMe[key]).toBeTruthy();
    }
  });
});
