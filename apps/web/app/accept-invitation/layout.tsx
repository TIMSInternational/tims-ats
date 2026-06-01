'use client';

import { TRPCProvider } from '../../lib/trpc-provider';

export default function AcceptInvitationLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
