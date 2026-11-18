import es from '../../../../../lib/i18n/es.json';
import en from '../../../../../lib/i18n/en.json';
import type { PortalMessages } from './provider-assessment-item';

// The frame around a TIMS test speaks the TEST's language (the attempt's locale, chosen by HR), not the portal's: a
// candidate who reads the portal in Spanish but sits the English test sees the English test with an English bar, as on
// timssuite.com. A locale this portal has no strings for falls back to the portal's own language.
const BY_TEST_LOCALE: Record<string, PortalMessages> = {
  es: es.portalDashboard,
  en: en.portalDashboard,
};

export function frameMessages(testLocale: string | undefined, portal: PortalMessages): PortalMessages {
  return (testLocale && BY_TEST_LOCALE[testLocale.toLowerCase()]) || portal;
}
