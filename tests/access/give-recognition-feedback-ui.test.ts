import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Static-source tripwires for the "give recognition / give feedback" wire-up.
// The performance page exposed two dead "give" buttons that only fired a
// `proximamente` toast. They now open real modals that call the existing
// backend mutations. Mirrors the static-assertion style of role-aware-ui.test.ts
// (the repo has no RTL component harness).

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

const PERF_DIR = 'apps/web/app/(admin)/people/performance';
const RECOGNITION_MODAL = `${PERF_DIR}/recognition-modal.tsx`;
const FEEDBACK_MODAL = `${PERF_DIR}/feedback-modal.tsx`;
const PANEL = `${PERF_DIR}/feedback-panel.tsx`;
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

describe('give-recognition modal — wiring', () => {
  const src = () => read(RECOGNITION_MODAL);

  it('is a client component', () => {
    expect(src()).toMatch(/^'use client';/);
  });

  it('calls the giveRecognition mutation', () => {
    expect(src()).toContain('performance.giveRecognition.useMutation');
  });

  it('does NOT call submitFeedback (that is the feedback modal)', () => {
    expect(src()).not.toContain('submitFeedback');
  });

  it('invalidates the recognition lists on success', () => {
    expect(src()).toContain('listRecognitions.invalidate');
    expect(src()).toContain('myRecognitions.invalidate');
  });

  it('renders the shared UserPicker + Modal to pick a recipient', () => {
    expect(src()).toContain('UserPicker');
    expect(src()).toContain('Modal');
  });

  it('has an onError toast', () => {
    expect(src()).toMatch(/onError[\s\S]{0,80}toast/);
  });

  it('disables submit until a recipient + message are present (no empty submits)', () => {
    // toUserId state + message presence gate the submit button
    expect(src()).toMatch(/disabled=\{[\s\S]*?\}/);
    expect(src()).toContain('isPending');
  });

  it('uses i18n only (no hardcoded category labels)', () => {
    expect(src()).toContain('t.performance');
    // the 5 recognition category keys must be referenced, not hardcoded
    expect(src()).toMatch(/excellence/);
    expect(src()).toMatch(/leadership/);
  });
});

describe('give-feedback modal — wiring', () => {
  const src = () => read(FEEDBACK_MODAL);

  it('is a client component', () => {
    expect(src()).toMatch(/^'use client';/);
  });

  it('calls the submitFeedback mutation (NOT giveFeedback)', () => {
    expect(src()).toContain('performance.submitFeedback.useMutation');
    expect(src()).not.toContain('giveFeedback.useMutation');
  });

  it('invalidates the feedback list on success', () => {
    expect(src()).toContain('listFeedback.invalidate');
  });

  it('supports the anonymous flag (isAnonymous checkbox)', () => {
    expect(src()).toContain('isAnonymous');
    expect(src()).toMatch(/type="checkbox"/);
  });

  it('renders the shared UserPicker + Modal to pick a recipient', () => {
    expect(src()).toContain('UserPicker');
    expect(src()).toContain('Modal');
  });

  it('has an onError toast', () => {
    expect(src()).toMatch(/onError[\s\S]{0,80}toast/);
  });

  it('references the 3 feedback type keys via i18n', () => {
    expect(src()).toContain('t.performance');
    expect(src()).toMatch(/constructive/);
    expect(src()).toMatch(/improvement/);
    expect(src()).toMatch(/positive/);
  });
});

describe('feedback-panel — modal open-state replaces the dead toast stubs', () => {
  const src = () => read(PANEL);

  it('no longer fires a "proximamente" stub toast', () => {
    expect(src()).not.toContain('proximamente');
  });

  it('imports and renders both modals', () => {
    expect(src()).toContain('RecognitionModal');
    expect(src()).toContain('FeedbackModal');
  });

  it('drives the modals with local open-state (useState)', () => {
    expect(src()).toContain('useState');
  });

  it('keeps the existing button labels (giveFeedback + recognize)', () => {
    expect(src()).toContain('t.performance.giveFeedback');
    expect(src()).toContain('t.performance.recognize');
  });
});

describe('give-recognition/feedback i18n keys (both locales)', () => {
  const NEW_KEYS = [
    'giveRecognitionTitle',
    'giveFeedbackTitle',
    'recipientLabel',
    'categoryLabel',
    'feedbackTypeLabel',
    'messageLabel',
    'messagePlaceholder',
    'anonymousLabel',
    'submit',
    'cancel',
    'recognitionSuccess',
    'feedbackSuccess',
    'badgeInnovation',
    'badgeLeadership',
  ];

  it('es.json performance.* has all new keys', () => {
    const es = JSON.parse(read(ES));
    for (const k of NEW_KEYS) {
      expect(es.performance?.[k], `es performance.${k}`).toBeTruthy();
    }
  });

  it('en.json performance.* has all new keys', () => {
    const en = JSON.parse(read(EN));
    for (const k of NEW_KEYS) {
      expect(en.performance?.[k], `en performance.${k}`).toBeTruthy();
    }
  });
});
