// Pure Content-Security-Policy builder used by `middleware.ts`. Kept free of
// Next.js imports so every directive can be unit-tested per pathname.

export interface CspOrigins {
  /** C# Platform API origin, or '' when unset. */
  platformApi: string;
  /** Origin the browser POSTs CV files to (S3 presigned POST), or '' when unset. */
  cvUpload: string;
}

/** Origin of an absolute URL, or '' when unset/invalid. */
export function originOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

const AWS_REGION_RE = /^[a-z]{2}(-[a-z]+)+-\d{1,2}$/;
// @aws-sdk/s3-presigned-post (via the S3 client's bucket-endpoint logic) uses a
// virtual-hosted URL only for DNS-compatible bucket names WITHOUT dots over
// https; anything else is addressed path-style on the regional endpoint.
// Verified against the installed SDK: `tims-cv` in us-west-2 ->
// https://tims-cv.s3.us-west-2.amazonaws.com/ ; `my.dotted.bucket` ->
// https://s3.us-west-2.amazonaws.com/my.dotted.bucket
const VIRTUAL_HOSTABLE_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const ANY_BUCKET_RE = /^[A-Za-z0-9._-]{3,255}$/;

/**
 * The exact origin `createPresignedPost` (packages/api/src/lib/s3.ts) returns for
 * this bucket/region, so connect-src can allow the CV upload POST without a
 * `*.amazonaws.com` wildcard. '' when the bucket is unset (CSP gains nothing).
 */
export function s3PresignedPostOrigin(bucket: string | undefined, region: string | undefined): string {
  if (!bucket || !ANY_BUCKET_RE.test(bucket)) return '';
  const r = region || 'us-east-1';
  if (!AWS_REGION_RE.test(r)) return '';
  return VIRTUAL_HOSTABLE_BUCKET_RE.test(bucket)
    ? `https://${bucket}.s3.${r}.amazonaws.com`
    : `https://s3.${r}.amazonaws.com`;
}

/**
 * Pages that create a Daily call object (@daily-co/daily-react DailyProvider).
 * Only these get Daily's script/connect relaxation. Entry into these pages
 * must be a full document navigation (plain <a>, not next/link) so the browser
 * actually receives this route's CSP instead of keeping the previous page's.
 */
const DAILY_CALL_ROUTE_RE = /^\/recruitment\/interviews\/[^/]+\/room\/?$/;

export function isDailyCallRoute(pathname: string): boolean {
  return DAILY_CALL_ROUTE_RE.test(pathname);
}

// Daily's documented CSP for a custom call object with `avoidEval: true`
// (https://docs.daily.co/guides/privacy-and-security/content-security-policy):
// the call-machine bundle is loaded by <script> from Daily's CDN (+ its failover
// domains) instead of fetch+Function(), so NO 'unsafe-eval' is needed.
const DAILY_SCRIPT_SRC = 'https://*.daily.co https://*.dailywebrtc.com https://*.dailywebrtc.net';
// *.daily.co (https+wss) is already allowed site-wide; the failover domains and
// Daily's key-server host are added only on the call route.
const DAILY_EXTRA_CONNECT_SRC =
  'https://*.dailywebrtc.com https://*.dailywebrtc.net wss://*.dailywebrtc.com wss://*.dailywebrtc.net https://prod-ks.pluot.blue';

// Per-request, nonce-based CSP. In production the nonce replaces
// 'unsafe-inline' on script-src (Next.js stamps the same nonce onto its
// bootstrap scripts via the request CSP header). Dev keeps
// 'unsafe-inline'/'unsafe-eval' so Turbopack/HMR's inline scripts run.
// style-src keeps 'unsafe-inline' (Tailwind/Next inject inline styles).
export function buildCsp(nonce: string, pathname: string, origins: CspOrigins, isProd: boolean): string {
  const daily = isDailyCallRoute(pathname);
  const scriptSrc = [
    "script-src 'self'",
    isProd ? `'nonce-${nonce}'` : "'unsafe-inline' 'unsafe-eval'",
    'https://challenges.cloudflare.com',
    daily ? DAILY_SCRIPT_SRC : '',
  ]
    .filter(Boolean)
    .join(' ');

  const connectSrc = [
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://login.microsoftonline.com https://*.daily.co wss://*.daily.co https://*.wss.daily.co https://*.elevenlabs.io wss://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud https://challenges.cloudflare.com https://*.sentry.io",
    origins.platformApi,
    origins.cvUpload,
    daily ? DAILY_EXTRA_CONNECT_SRC : '',
  ]
    .filter(Boolean)
    .join(' ');

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://*.cloudfront.net",
    connectSrc,
    "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://*.daily.co https://challenges.cloudflare.com",
    "media-src 'self' blob: https://*.daily.co https://*.elevenlabs.io",
    // ElevenLabs Conversational AI loads its audio-processing AudioWorklet from a
    // blob URL; without worker-src blob: the live voice call fails to initialise.
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
  ].join('; ');
}
