import { beforeEach, describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { isAiDisabledCode, localizeKnownErrorCode } from '../../apps/web/lib/known-error-codes';
import { AI_DISABLED } from '../../packages/ai/src/kill-switch';

// #312: the stable `consent_withdrawn` codes are translated wherever an error toast shows them.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  };
});

describe('localizeKnownErrorCode', () => {
  it('Spanish by default', () => {
    expect(localizeKnownErrorCode('consent_withdrawn')).toBe(es.consentGuard.withdrawn);
    expect(localizeKnownErrorCode('consent_withdrawn:3')).toBe(es.consentGuard.withdrawnBulk.replace('{n}', '3'));
  });

  it('English when the persisted locale is EN', () => {
    store.set('tims-locale', 'EN');
    expect(localizeKnownErrorCode('consent_withdrawn')).toBe(en.consentGuard.withdrawn);
    expect(localizeKnownErrorCode('consent_withdrawn:2')).toBe(en.consentGuard.withdrawnBulk.replace('{n}', '2'));
  });

  it('translates the AI kill-switch code (the same string packages/ai throws)', () => {
    expect(localizeKnownErrorCode(AI_DISABLED)).toBe(es.common.aiDisabled);
    store.set('tims-locale', 'EN');
    expect(localizeKnownErrorCode(AI_DISABLED)).toBe(en.common.aiDisabled);
  });

  it('leaves every other message alone', () => {
    expect(localizeKnownErrorCode('Oferta no encontrada')).toBe('Oferta no encontrada');
    expect(localizeKnownErrorCode('consent_withdrawn:abc')).toBe('consent_withdrawn:abc');
    expect(localizeKnownErrorCode('ai_disabled:x')).toBe('ai_disabled:x');
  });
});

describe('isAiDisabledCode', () => {
  it('matches only the kill-switch code (used where an error is rendered inline, not toasted)', () => {
    expect(isAiDisabledCode(AI_DISABLED)).toBe(true);
    expect(isAiDisabledCode(` ${AI_DISABLED} `)).toBe(true);
    expect(isAiDisabledCode('ai_disabled:x')).toBe(false);
    expect(isAiDisabledCode('consent_withdrawn')).toBe(false);
  });
});
