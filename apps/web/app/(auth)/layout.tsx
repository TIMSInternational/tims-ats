import type { Metadata } from 'next';
import es from '../../lib/i18n/es.json';
import { AuthShell } from './auth-shell';

// Server layout so the staff auth pages (login, password recovery, registration notice) carry the
// product name in the browser tab instead of the root layout's generic title. Spanish: the auth pages
// render in the default locale (no language toggle before sign-in).
export const metadata: Metadata = {
  title: es.auth.platformName,
  description: es.auth.metaDescription,
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
