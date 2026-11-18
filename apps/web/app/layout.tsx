import type { Metadata } from 'next';
import { Inter, Poppins } from 'next/font/google';
import './globals.css';
import es from '../lib/i18n/es.json';
import { isWebAnalyticsEnabled } from '../lib/analytics/web-analytics';
import { WebAnalytics } from '../components/web-analytics';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const poppins = Poppins({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-poppins' });

// Render every route dynamically so Next.js can stamp the per-request CSP nonce
// (set in middleware.ts) onto its inline bootstrap scripts. Statically
// prerendered HTML can't carry a per-request nonce, so those scripts would be
// blocked by the nonce-based CSP. Cascades to all nested segments.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // The product name, the same one the auth pages show; staff pages prefix it with the page name
  // (navbar/index.tsx), so a tab never reads only the app name (toolbars.md › Titles).
  title: es.auth.platformName,
  description: 'Human Capital Management by TIMS International',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${poppins.variable}`}>
      <body className="font-sans antialiased bg-surface text-primary">
        {children}
        {/* Cookieless Vercel Web Analytics, off unless NEXT_PUBLIC_WEB_ANALYTICS_ENABLED is 'true'. */}
        {isWebAnalyticsEnabled() && <WebAnalytics />}
      </body>
    </html>
  );
}
