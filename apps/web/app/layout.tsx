import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

// Render every route dynamically so Next.js can stamp the per-request CSP nonce
// (set in middleware.ts) onto its inline bootstrap scripts. Statically
// prerendered HTML can't carry a per-request nonce, so those scripts would be
// blocked by the nonce-based CSP. Cascades to all nested segments.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'TIMS Platform',
  description: 'Human Capital Management by TIMS International',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="font-sans antialiased bg-[#F6F6F6] text-[#333]">
        {children}
      </body>
    </html>
  );
}
