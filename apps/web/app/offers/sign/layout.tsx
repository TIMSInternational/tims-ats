'use client';

import { TRPCProvider } from '../../../lib/trpc-provider';

export default function OfferSignLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
