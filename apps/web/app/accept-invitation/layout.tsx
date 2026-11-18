import type { Metadata } from 'next';
import es from '../../lib/i18n/es.json';
import { InvitationProviders } from './invitation-providers';

// A tab title for the invitee instead of the root default (toolbars.md › Titles). Spanish: default locale.
export const metadata: Metadata = {
  title: `${es.acceptInvitation.pageTitle} · ${es.auth.platformName}`,
};

export default function AcceptInvitationLayout({ children }: { children: React.ReactNode }) {
  return <InvitationProviders>{children}</InvitationProviders>;
}
