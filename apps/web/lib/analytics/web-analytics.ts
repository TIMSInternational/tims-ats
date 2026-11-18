import { track } from '@vercel/analytics';
import type { BeforeSendEvent } from '@vercel/analytics/next';
import { isBearerLinkPathname } from '../security/bearer-links';

// Vercel Web Analytics: cookieless page views plus three careers funnel events. Off by default:
//
//   NEXT_PUBLIC_WEB_ANALYTICS_ENABLED=true  → the root layout mounts <WebAnalytics/> and the funnel events fire.
//   unset (or anything else)                → nothing is loaded and nothing is sent.
//
// What leaves the browser is scrubbed first (scrubAnalyticsEvent): pages whose URL is a credential are never
// reported, query strings and fragments are dropped, and identifier-shaped path segments are replaced. Funnel
// events carry only the organization's public careers slug, never a candidate, an email or an id.

/** Only the exact string 'true' turns Web Analytics on. Must stay a literal reference so Next inlines it. */
export function isWebAnalyticsEnabled(
  raw: string | undefined = process.env.NEXT_PUBLIC_WEB_ANALYTICS_ENABLED,
): boolean {
  return raw === 'true';
}

const UUID_IN_SEGMENT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const REDACTED_SEGMENT = '[id]';

/** A path segment that is (or contains) an identifier or an opaque token rather than a route name. */
function isIdentifierSegment(segment: string): boolean {
  return UUID_IN_SEGMENT.test(segment) || (segment.length >= 20 && /\d/.test(segment));
}

/**
 * The URL as it may be reported: origin + path, with identifier segments replaced, no query and no fragment.
 * Null (do not report) for a credential-bearing page or a URL that does not parse.
 */
export function scrubAnalyticsUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (isBearerLinkPathname(parsed.pathname)) return null;
  const path = parsed.pathname
    .split('/')
    .map((segment) => (isIdentifierSegment(segment) ? REDACTED_SEGMENT : segment))
    .join('/');
  return `${parsed.origin}${path}`;
}

/** `beforeSend` for <Analytics/>: every page view and event goes through scrubAnalyticsUrl. */
export function scrubAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = scrubAnalyticsUrl(event.url);
  return url ? { ...event, url } : null;
}

/** The careers funnel: the board was viewed, the apply form was opened, an application was submitted. */
export type CareersFunnelEvent = 'careers_view' | 'apply_started' | 'application_submitted';

interface PendingFunnelStep {
  readonly event: CareersFunnelEvent;
  readonly orgSlug: string;
}

// A funnel step can be recorded before <Analytics/> has set up its command queue: on a full page load the
// board's mount effect runs before the root layout's <WebAnalytics/>, and `track()` silently does nothing
// without the queue. Such steps wait here (bounded) and are sent once the queue exists. They are never sent
// earlier: <Analytics/> creates the queue and registers `beforeSend` (the scrubber) in the same synchronous
// step, so anything sent after the queue appears is scrubbed.
export const MAX_PENDING_FUNNEL_STEPS = 10;
export const FUNNEL_RETRY_MS = 100;
export const FUNNEL_MAX_RETRIES = 50;

const pendingFunnelSteps: PendingFunnelStep[] = [];
let funnelRetryTimer: ReturnType<typeof setTimeout> | null = null;
let funnelRetries = 0;

/** True once <Analytics/> has run: its command queue (window.va) exists and `beforeSend` is registered. */
function isAnalyticsQueueReady(): boolean {
  return typeof window !== 'undefined' && typeof window.va === 'function';
}

function sendFunnelStep({ event, orgSlug }: PendingFunnelStep): void {
  try {
    track(event, { org: orgSlug });
  } catch {
    // Analytics must never interrupt the candidate's flow.
  }
}

function cancelFunnelRetry(): void {
  if (funnelRetryTimer !== null) clearTimeout(funnelRetryTimer);
  funnelRetryTimer = null;
  funnelRetries = 0;
}

function scheduleFunnelRetry(): void {
  if (funnelRetryTimer !== null) return;
  if (funnelRetries >= FUNNEL_MAX_RETRIES) {
    // Analytics never started on this page: drop what is waiting rather than hold it forever.
    pendingFunnelSteps.length = 0;
    funnelRetries = 0;
    return;
  }
  funnelRetries += 1;
  funnelRetryTimer = setTimeout(() => {
    funnelRetryTimer = null;
    flushCareersFunnel();
  }, FUNNEL_RETRY_MS);
}

/**
 * Sends the funnel steps that were waiting for analytics to start, in the order they happened. Called by
 * <WebAnalytics/> once it has mounted, and retried on a short timer until the queue exists.
 */
export function flushCareersFunnel(): void {
  if (!isAnalyticsQueueReady()) {
    if (pendingFunnelSteps.length > 0) scheduleFunnelRetry();
    return;
  }
  cancelFunnelRetry();
  for (const step of pendingFunnelSteps.splice(0)) sendFunnelStep(step);
}

/** Records a funnel step for an organization's careers portal. A no-op unless Web Analytics is on. */
export function trackCareersFunnel(
  event: CareersFunnelEvent,
  orgSlug: string,
  enabled: boolean = isWebAnalyticsEnabled(),
): void {
  if (!enabled) return;
  if (pendingFunnelSteps.length >= MAX_PENDING_FUNNEL_STEPS) return;
  pendingFunnelSteps.push({ event, orgSlug });
  flushCareersFunnel();
}
