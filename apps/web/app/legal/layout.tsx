import { I18nProvider } from '../../lib/i18n';

// Platform legal pages (/legal/*). Public (see PUBLIC_PATHS in middleware.ts) and gated per page
// by NEXT_PUBLIC_LEGAL_PAGES_ENABLED — while the flag is off every /legal route is a 404.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}
