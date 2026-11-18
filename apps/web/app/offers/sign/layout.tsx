import type { Metadata } from 'next';
import { TRPCProvider } from '../../../lib/trpc-provider';

// Offer-acceptance links carry a bearer token: never index them (middleware also sends X-Robots-Tag).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function OfferSignLayout({ children }: { children: React.ReactNode }) {
  return <TRPCProvider>{children}</TRPCProvider>;
}
