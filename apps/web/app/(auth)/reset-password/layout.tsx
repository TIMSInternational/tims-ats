import type { Metadata } from 'next';
import es from '../../../lib/i18n/es.json';

// A tab title per step, not the bare product name (toolbars.md › Titles). Spanish: the default locale.
export const metadata: Metadata = {
  title: `${es.auth.newPassword} · ${es.auth.platformName}`,
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return children;
}
