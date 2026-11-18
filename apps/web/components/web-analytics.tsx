'use client';

import { useEffect } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { flushCareersFunnel, scrubAnalyticsEvent } from '../lib/analytics/web-analytics';

/**
 * Vercel Web Analytics (cookieless). The root layout mounts this only when NEXT_PUBLIC_WEB_ANALYTICS_ENABLED is
 * 'true'. Every page view and event is scrubbed before it leaves the browser (lib/analytics/web-analytics.ts).
 * A client component because `beforeSend` is a function, which a server component cannot pass down.
 *
 * Effects run children first, so by the time this component's effect runs <Analytics/> has normally set up its
 * queue and the funnel steps a page recorded while loading can be sent (flushCareersFunnel retries otherwise).
 */
export function WebAnalytics() {
  useEffect(() => flushCareersFunnel(), []);
  return <Analytics beforeSend={scrubAnalyticsEvent} />;
}
