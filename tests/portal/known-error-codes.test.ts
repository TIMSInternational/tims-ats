import { beforeEach, describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { localizeKnownErrorCode } from '../../apps/web/lib/known-error-codes';

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

  it('leaves every other message alone', () => {
    expect(localizeKnownErrorCode('Oferta no encontrada')).toBe('Oferta no encontrada');
    expect(localizeKnownErrorCode('consent_withdrawn:abc')).toBe('consent_withdrawn:abc');
  });
});
