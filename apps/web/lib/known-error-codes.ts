import es from './i18n/es.json';
import en from './i18n/en.json';

// Stable machine codes some server errors carry instead of copy (e.g. #312's `consent_withdrawn` /
// `consent_withdrawn:<n>`, and `ai_disabled` from the @tims/ai kill switch), translated wherever an error
// message is shown in a toast. Locale is the one the I18nProvider persisted (`tims-locale`); anything
// unreadable falls back to Spanish.
const CONSENT_WITHDRAWN = /^consent_withdrawn(?::(\d{1,4}))?$/;
// Mirrors AI_DISABLED in packages/ai/src/kill-switch.ts (apps/web does not depend on @tims/ai).
const AI_DISABLED = 'ai_disabled';

function currentMessages() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('tims-locale') === 'EN' ? en : es;
  } catch {
    return es;
  }
}

/** The translated message for a known error code, or the input unchanged. */
export function localizeKnownErrorCode(message: string): string {
  if (message.trim() === AI_DISABLED) return currentMessages().common.aiDisabled;
  const match = CONSENT_WITHDRAWN.exec(message.trim());
  if (!match) return message;
  const m = currentMessages().consentGuard;
  return match[1] ? m.withdrawnBulk.replace('{n}', match[1]) : m.withdrawn;
}
