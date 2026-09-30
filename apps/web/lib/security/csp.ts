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

// Only regions whose S3 endpoints live under `amazonaws.com`: the standard
// `aws` partition plus `aws-us-gov` (us-gov-*). Other partitions use other
// DNS suffixes (cn-* -> amazonaws.com.cn, us-iso-* -> c2s.ic.gov, us-isob-* ->
// sc2s.sgov.gov, eusc-* -> amazonaws.eu), so they are deliberately unsupported
// and yield no origin rather than a wrong one.
const AWS_REGION_RE = /^(?:(?:us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+|us-gov-[a-z]+)-\d{1,2}$/;

/** True when `s3PresignedPostOrigin` can derive this region's endpoint. */
export function isSupportedS3Region(region: string): boolean {
  return AWS_REGION_RE.test(region);
}
// @aws-sdk/s3-presigned-post (via the S3 client's bucket-endpoint logic) uses a
// virtual-hosted URL only for DNS-compatible bucket names WITHOUT dots over
// https; anything else is addressed path-style on the regional endpoint
// (`https://s3.<region>.amazonaws.com/<bucket>`). Verified against the
// installed SDK: `tims-cv` in us-west-2 -> https://tims-cv.s3.us-west-2.amazonaws.com/
// A path-style origin is REGION-WIDE (every bucket in the region shares it), so
// allowing it would widen connect-src to any attacker-owned bucket there. Such
// buckets are therefore not supported: no origin is emitted (see
// cvUploadCspOrigin, which warns).
const VIRTUAL_HOSTABLE_BUCKET_RE = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * The exact origin `createPresignedPost` (packages/api/src/lib/s3.ts) returns for
 * this bucket/region, so connect-src can allow the CV upload POST without a
 * `*.amazonaws.com` wildcard. '' when it cannot be derived EXACTLY: bucket or
 * region unset (no default region — s3.ts has none either), unsupported
 * partition, or a bucket name that would be addressed path-style.
 */
export function s3PresignedPostOrigin(bucket: string | undefined, region: string | undefined): string {
  if (!bucket || !region) return '';
  if (!VIRTUAL_HOSTABLE_BUCKET_RE.test(bucket)) return '';
  if (!AWS_REGION_RE.test(region)) return '';
  return `https://${bucket}.s3.${region}.amazonaws.com`;
}

/**
 * Resolves the CV-upload connect-src origin from the SAME explicit variables
 * s3.ts requires (CV_UPLOADS_BUCKET + CV_UPLOADS_REGION — never AWS_REGION,
 * which on Vercel is the function's own region and may be absent at the Edge).
 * When the bucket is set but no exact origin can be derived, the origin is
 * omitted (never widened) and a loud warning explains why CV uploads will be
 * blocked. Returns '' and stays silent when the bucket is unset (feature dark).
 */
export function cvUploadCspOrigin(
  bucket: string | undefined,
  region: string | undefined,
  warn: (message: string) => void = console.warn,
): string {
  if (!bucket) return '';
  const origin = s3PresignedPostOrigin(bucket, region);
  if (origin) return origin;
  let reason: string;
  if (!region) {
    reason = "CV_UPLOADS_REGION is not set (it must be the bucket's own region; AWS_REGION is deliberately not used)";
  } else if (!AWS_REGION_RE.test(region)) {
    reason = 'CV_UPLOADS_REGION is not a supported amazonaws.com region';
  } else {
    reason =
      'CV_UPLOADS_BUCKET is not a virtual-hostable name (dots/uppercase/invalid); its path-style origin is region-wide and is not allowed';
  }
  warn(
    `[csp] CV_UPLOADS_BUCKET is set but no S3 origin was added to connect-src: ${reason}. CV uploads will be blocked.`,
  );
  return '';
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
