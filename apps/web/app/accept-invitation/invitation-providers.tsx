'use client';

import { TRPCProvider } from '../../lib/trpc-provider';
import { I18nProvider } from '../../lib/i18n';
import { AuthShell } from '../(auth)/auth-shell';

// The invitation renders in the same frame as /login (branding.md › Best practices), and its language
// toggle goes through the app's saved locale like every other screen.
export function InvitationProviders({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <TRPCProvider>
        <AuthShell>{children}</AuthShell>
      </TRPCProvider>
    </I18nProvider>
  );
}
