'use client';

import { Analytics } from '@vercel/analytics/next';
import { scrubAnalyticsEvent } from '../lib/analytics/web-analytics';

/**
 * Vercel Web Analytics (cookieless). The root layout mounts this only when NEXT_PUBLIC_WEB_ANALYTICS_ENABLED is
 * 'true'. Every page view and event is scrubbed before it leaves the browser (lib/analytics/web-analytics.ts).
 * A client component because `beforeSend` is a function, which a server component cannot pass down.
 */
export function WebAnalytics() {
  return <Analytics beforeSend={scrubAnalyticsEvent} />;
}
