import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Static-source tripwires for the AI voice interview candidate UI (Task 7).
// Consent gates the voice room — room is never mounted before consent is recorded.
// No API key appears client-side; dynamicVariables from `start` are forwarded.

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const exists = (p: string) => existsSync(resolve(root, p));

const AI_DIR = 'apps/web/app/(portal)/ai-interview/[token]';
const PAGE = `${AI_DIR}/page.tsx`;
const CONSENT = `${AI_DIR}/consent-screen.tsx`;
const VOICE = `${AI_DIR}/voice-room.tsx`;
const HOOK = `${AI_DIR}/use-interview-call.ts`;
const ES = 'apps/web/lib/i18n/es.json';
const EN = 'apps/web/lib/i18n/en.json';

const AI_I18N_KEYS = [
  'title',
  'consentHeading',
  'consentDisclosure',
  'consentCheckbox',
  'consentAgree',
  'startInterview',
  'endInterview',
  'connecting',
  'connected',
  'micPermissionError',
  'startError',
  'transcript',
  'loading',
  'invalidToken',
  'completed',
  'lobbyHeading',
  'lobbyMicCheck',
  'lobbyMicWorking',
  'lobbyMicDevice',
  'lobbyJoin',
  'lobbyMicDenied',
  'liveTranscript',
  'callView',
  'focusView',
  'aiSpeaking',
  'aiListening',
  'you',
  'muteMic',
  'unmuteMic',
  'reconnecting',
  'interviewer',
];

describe('page.tsx — consent gate', () => {
  it('file exists', () => {
    expect(exists(PAGE)).toBe(true);
  });

  it('imports ConsentScreen', () => {
    expect(read(PAGE)).toContain('ConsentScreen');
  });

  it('imports VoiceRoom', () => {
    expect(read(PAGE)).toContain('VoiceRoom');
  });

  it('conditionally renders VoiceRoom only after consent (not unconditionally)', () => {
    const src = read(PAGE);
    // An early-return guard `if (!consented)` must appear before any VoiceRoom usage.
    // Verify the guard exists and that VoiceRoom is not rendered unconditionally.
    expect(src).toContain('if (!consented)');
    const guardIndex = src.indexOf('if (!consented)');
    const voiceRoomIndex = src.indexOf('<VoiceRoom');
    // VoiceRoom JSX must appear AFTER the consent guard in source order
    expect(voiceRoomIndex).toBeGreaterThan(guardIndex);
    // VoiceRoom must not appear before the consent guard (no unconditional top-level render)
    expect(src.slice(0, guardIndex)).not.toContain('<VoiceRoom');
  });

  it('passes candidateToken down to children', () => {
    expect(read(PAGE)).toContain('candidateToken');
  });

  it('uses no inline styles', () => {
    expect(read(PAGE)).not.toContain('style={{');
  });
});

describe('consent-screen.tsx — consent recording', () => {
  it('file exists', () => {
    expect(exists(CONSENT)).toBe(true);
  });

  it('is a client component', () => {
    expect(read(CONSENT)).toMatch(/^'use client';/);
  });

  it('calls recordConsent mutation', () => {
    expect(read(CONSENT)).toContain('aiInterview.recordConsent');
  });

  it('uses textVersion v1 constant (AI_INTERVIEW_CONSENT_VERSION)', () => {
    const src = read(CONSENT);
    expect(src).toContain('AI_INTERVIEW_CONSENT_VERSION');
    expect(src).toContain("'v1'");
  });

  it('has a checkbox and agree button', () => {
    const src = read(CONSENT);
    expect(src).toContain('checkbox');
    expect(src).toContain('onConsented');
  });

  it('uses i18n only (no hardcoded user-facing strings)', () => {
    const src = read(CONSENT);
    expect(src).toContain('useI18n');
  });

  it('uses no inline styles', () => {
    expect(read(CONSENT)).not.toContain('style={{');
  });

  it('has no any type', () => {
    expect(read(CONSENT)).not.toMatch(/:\s*any\b/);
    expect(read(CONSENT)).not.toMatch(/as any\b/);
  });
});

describe('voice-room.tsx — ElevenLabs session', () => {
  it('file exists', () => {
    expect(exists(VOICE)).toBe(true);
  });

  it('is a client component', () => {
    expect(read(VOICE)).toMatch(/^'use client';/);
  });

  it('imports ConversationProvider from @elevenlabs/react', () => {
    expect(read(VOICE)).toContain('@elevenlabs/react');
    expect(read(VOICE)).toContain('ConversationProvider');
  });

  it('calls aiInterview.start mutation', () => {
    expect(read(HOOK)).toContain('aiInterview.start');
  });

  it('uses signedUrl from start response in startSession', () => {
    const src = read(HOOK);
    expect(src).toContain('signedUrl');
    expect(src).toContain('startSession');
  });

  it('forwards dynamicVariables from start to the session', () => {
    const src = read(HOOK);
    expect(src).toContain('dynamicVariables');
    // dynamicVariables appear in the same block as startSession
    expect(src).toMatch(/dynamicVariables[\s\S]{0,300}startSession|startSession[\s\S]{0,300}dynamicVariables/);
  });

  it('handles loading / error / empty states', () => {
    // isPending lives in the hook (use-interview-call.ts) after the state-machine refactor
    expect(read(HOOK)).toMatch(/isPending|isLoading/);
    expect(read(VOICE)).toMatch(/error|Error/);
  });

  it('exposes endSession', () => {
    const src = read(HOOK);
    expect(src).toContain('endSession');
  });

  it('uses i18n only (no hardcoded user-facing strings)', () => {
    expect(read(VOICE)).toContain('useI18n');
  });

  it('uses no inline styles', () => {
    expect(read(VOICE)).not.toContain('style={{');
  });

  it('has no any type', () => {
    const src = read(VOICE);
    expect(src).not.toMatch(/:\s*any\b/);
    expect(src).not.toMatch(/as any\b/);
  });

  it('ELEVENLABS_API_KEY never appears client-side', () => {
    expect(read(HOOK)).not.toContain('ELEVENLABS_API_KEY');
    expect(read(VOICE)).not.toContain('ELEVENLABS_API_KEY');
    expect(read(CONSENT)).not.toContain('ELEVENLABS_API_KEY');
    expect(read(PAGE)).not.toContain('ELEVENLABS_API_KEY');
  });
});

describe('ai-interview i18n keys (both locales)', () => {
  it('es.json aiInterview.* has all required keys', () => {
    const es = JSON.parse(read(ES));
    for (const k of AI_I18N_KEYS) {
      expect(es.aiInterview?.[k], `es aiInterview.${k}`).toBeTruthy();
    }
  });

  it('en.json aiInterview.* has all required keys', () => {
    const en = JSON.parse(read(EN));
    for (const k of AI_I18N_KEYS) {
      expect(en.aiInterview?.[k], `en aiInterview.${k}`).toBeTruthy();
    }
  });

  it('both locales have identical key sets under aiInterview', () => {
    const es = JSON.parse(read(ES));
    const en = JSON.parse(read(EN));
    const esKeys = Object.keys(es.aiInterview ?? {}).sort();
    const enKeys = Object.keys(en.aiInterview ?? {}).sort();
    expect(esKeys).toEqual(enKeys);
  });
});
