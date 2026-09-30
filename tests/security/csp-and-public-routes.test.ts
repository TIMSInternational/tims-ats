import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Via packages/api's copy (the one s3.ts uses) — root tsc cannot resolve the bare specifier.
import { S3Client } from '../../packages/api/node_modules/@aws-sdk/client-s3';
import { createPresignedPost } from '../../packages/api/node_modules/@aws-sdk/s3-presigned-post';
import { NextRequest } from '../../apps/web/node_modules/next/server';
import {
  hardExitTarget,
  type AnchorClick,
} from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/hard-exit';
import {
  buildCsp,
  cvUploadCspOrigin,
  isDailyCallRoute,
  isSupportedS3Region,
  s3PresignedPostOrigin,
} from '../../apps/web/lib/security/csp';

const state = vi.hoisted(() => ({ user: null as null | { id: string } }));
vi.mock('@tims/auth/middleware', () => ({
  updateSession: async () => ({ supabaseResponse: new Response(null), user: state.user }),
}));

// middleware.ts resolves its CSP origins from env at module load, so each case
// that depends on env stubs it first and imports a fresh copy.
async function loadMiddleware() {
  vi.resetModules();
  return (await import('../../apps/web/middleware')).middleware;
}

function directive(csp: string, name: string): string {
  return csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';
}

const NO_ORIGINS = { platformApi: '', cvUpload: '' };

beforeEach(() => {
  state.user = null;
  vi.stubEnv('CV_UPLOADS_BUCKET', '');
  vi.stubEnv('CV_UPLOADS_REGION', '');
  vi.stubEnv('AWS_REGION', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('F5 — CV upload S3 origin in connect-src', () => {
  // Ground truth: the origin the installed SDK's createPresignedPost really returns.
  async function sdkOrigin(bucket: string, region: string): Promise<string> {
    const client = new S3Client({ region, credentials: { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'x' } });
    const { url } = await createPresignedPost(client, { Bucket: bucket, Key: 'k', Expires: 60 });
    return new URL(url).origin;
  }

  it.each([
    'us-east-1',
    'us-west-2',
    'eu-west-1',
    'eu-central-1',
    'ap-southeast-2',
    'ap-northeast-1',
    'sa-east-1',
    'ca-central-1',
    'me-south-1',
    'af-south-1',
    'il-central-1',
    'mx-central-1',
    'us-gov-west-1',
    'ap-southeast-5',
  ])('matches the SDK presigned-POST origin for a virtual-hostable bucket in %s', async (region) => {
    expect(s3PresignedPostOrigin('tims-cv-uploads', region)).not.toBe('');
    expect(s3PresignedPostOrigin('tims-cv-uploads', region)).toBe(await sdkOrigin('tims-cv-uploads', region));
  });

  it.each(['tims.cv.dotted', 'Tims-CV', 'my..bucket'])(
    'emits NO origin for %s — the SDK addresses it path-style on the REGION-WIDE endpoint',
    async (bucket) => {
      expect(s3PresignedPostOrigin(bucket, 'eu-west-1')).toBe('');
      if (bucket === 'tims.cv.dotted') {
        // Ground truth for why: allowing this origin would allow EVERY bucket in the region.
        expect(await sdkOrigin(bucket, 'eu-west-1')).toBe('https://s3.eu-west-1.amazonaws.com');
      }
      const warn = vi.fn<(m: string) => void>();
      expect(cvUploadCspOrigin(bucket, 'eu-west-1', warn)).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toMatch(/virtual-hostable/);
    },
  );

  it.each(['cn-north-1', 'cn-northwest-1', 'us-iso-east-1', 'us-isob-east-1', 'eusc-de-east-1'])(
    'returns NO origin for non-amazonaws.com partition %s (the SDK uses another DNS suffix there)',
    async (region) => {
      expect(isSupportedS3Region(region)).toBe(false);
      expect(s3PresignedPostOrigin('tims-cv-uploads', region)).toBe('');
      expect(await sdkOrigin('tims-cv-uploads', region)).not.toMatch(/\.amazonaws\.com$/);
    },
  );

  it('has NO default region (s3.ts has none either) — an unset region yields no origin', () => {
    expect(s3PresignedPostOrigin('tims-cv', undefined)).toBe('');
    expect(s3PresignedPostOrigin('tims-cv', '')).toBe('');
  });

  it('cvUploadCspOrigin is silent when the bucket is unset (feature dark)', () => {
    const warn = vi.fn<(m: string) => void>();
    expect(cvUploadCspOrigin(undefined, undefined, warn)).toBe('');
    expect(cvUploadCspOrigin('', 'us-east-1', warn)).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['unset', undefined, /CV_UPLOADS_REGION is not set/],
    ['unsupported partition', 'cn-north-1', /not a supported amazonaws\.com region/],
    ['malformed', "us-east-1 'unsafe-eval'", /not a supported amazonaws\.com region/],
  ])('cvUploadCspOrigin omits the origin and warns when the region is %s', (_label, region, reason) => {
    const warn = vi.fn<(m: string) => void>();
    expect(cvUploadCspOrigin('tims-cv-uploads', region, warn)).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(reason);
  });

  it('is empty (adds nothing) when the bucket is unset or the region is malformed', () => {
    expect(s3PresignedPostOrigin(undefined, 'us-east-1')).toBe('');
    expect(s3PresignedPostOrigin('', 'us-east-1')).toBe('');
    expect(s3PresignedPostOrigin('tims-cv', "us-east-1 'unsafe-eval'")).toBe('');
    expect(s3PresignedPostOrigin('bad bucket;', 'us-east-1')).toBe('');
  });

  it('agrees with s3.ts: both runtimes use CV_UPLOADS_REGION and ignore AWS_REGION', async () => {
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    vi.stubEnv('CV_UPLOADS_REGION', 'eu-west-1');
    vi.stubEnv('AWS_REGION', 'us-west-2');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDEXAMPLE');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'x');
    vi.resetModules();
    const { createCvUploadPresignedPost } = await import('../../packages/api/src/lib/s3');
    const { url } = await createCvUploadPresignedPost('org-1', 'application/pdf');

    const middleware = await loadMiddleware();
    const res = await middleware(
      new NextRequest('https://app.tims.com/careers/acme/v1', { headers: { host: 'app.tims.com' } }),
    );
    const connectSrc = directive(res.headers.get('content-security-policy') ?? '', 'connect-src');

    expect(new URL(url).origin).toBe('https://tims-cv-uploads.s3.eu-west-1.amazonaws.com');
    expect(connectSrc.split(' ')).toContain(new URL(url).origin);
  });

  it('bucket set + CV_UPLOADS_REGION unset: s3.ts throws, CSP omits the origin, middleware warns (no AWS_REGION fallback)', async () => {
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    // The Vercel function region — must NOT be used for the bucket by either runtime.
    vi.stubEnv('AWS_REGION', 'us-west-2');
    vi.stubEnv('AWS_ACCESS_KEY_ID', 'AKIDEXAMPLE');
    vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'x');
    vi.resetModules();
    const { createCvUploadPresignedPost } = await import('../../packages/api/src/lib/s3');
    await expect(createCvUploadPresignedPost('org-1', 'application/pdf')).rejects.toThrow(
      'CV_UPLOADS_REGION is not configured',
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const middleware = await loadMiddleware();
      const res = await middleware(
        new NextRequest('https://app.tims.com/careers/acme/v1', { headers: { host: 'app.tims.com' } }),
      );
      expect(res.headers.get('content-security-policy')).not.toContain('amazonaws');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/CV_UPLOADS_REGION is not set/));
    } finally {
      warn.mockRestore();
    }
  });

  it('middleware warns and omits the origin for an unsupported CV_UPLOADS_REGION', async () => {
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    vi.stubEnv('CV_UPLOADS_REGION', 'cn-north-1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const middleware = await loadMiddleware();
      const res = await middleware(
        new NextRequest('https://app.tims.com/careers/acme/v1', { headers: { host: 'app.tims.com' } }),
      );
      expect(res.headers.get('content-security-policy')).not.toContain('amazonaws');
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not a supported amazonaws\.com region/));
    } finally {
      warn.mockRestore();
    }
  });

  it('middleware adds ONLY the bucket origin — no *.amazonaws.com wildcard', async () => {
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    vi.stubEnv('CV_UPLOADS_REGION', 'us-west-2');
    const middleware = await loadMiddleware();
    const res = await middleware(
      new NextRequest('https://app.tims.com/careers/acme/v1', { headers: { host: 'app.tims.com' } }),
    );
    const connectSrc = directive(res.headers.get('content-security-policy') ?? '', 'connect-src');

    expect(connectSrc.split(' ')).toContain('https://tims-cv-uploads.s3.us-west-2.amazonaws.com');
    expect(connectSrc).not.toContain('*.amazonaws.com');
    expect(connectSrc.match(/amazonaws/g)).toHaveLength(1);
  });

  it('middleware adds no S3 origin when CV_UPLOADS_BUCKET is unset', async () => {
    const middleware = await loadMiddleware();
    const res = await middleware(
      new NextRequest('https://app.tims.com/careers/acme/v1', { headers: { host: 'app.tims.com' } }),
    );
    expect(res.headers.get('content-security-policy')).not.toContain('amazonaws');
  });
});

describe('env schema — CV_UPLOADS_REGION with CV_UPLOADS_BUCKET', () => {
  function stubRequiredEnv() {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/x');
    vi.stubEnv('NODE_ENV', 'production');
  }

  it('warns (without failing validation, so admin pages stay up) when the bucket is set without a region', async () => {
    stubRequiredEnv();
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    vi.stubEnv('CV_UPLOADS_REGION', '');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.resetModules();
      const { env } = await import('../../apps/web/lib/env');
      expect(env.CV_UPLOADS_BUCKET).toBe('tims-cv-uploads');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('CV_UPLOADS_REGION'));
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ['bucket + region', 'tims-cv-uploads', 'us-west-2'],
    ['neither (feature dark)', '', ''],
  ])('accepts %s', async (_label, bucket, region) => {
    stubRequiredEnv();
    vi.stubEnv('CV_UPLOADS_BUCKET', bucket);
    vi.stubEnv('CV_UPLOADS_REGION', region);
    vi.resetModules();
    const { env } = await import('../../apps/web/lib/env');
    expect(env.CV_UPLOADS_REGION).toBe(region || undefined);
  });
});

describe('bearer-link pages never leak their token (Referer / shared cache)', () => {
  it.each(['/offers/sign/tok_abc', '/accept-invitation', '/reset-password'])(
    '%s gets referrer-policy no-referrer + cache-control no-store',
    async (path) => {
      const middleware = await loadMiddleware();
      const res = await middleware(
        new NextRequest(`https://app.tims.com${path}`, { headers: { host: 'app.tims.com' } }),
      );
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('no-store');
    },
  );

  it.each(['/careers/acme/v1', '/offers/signatures'])('%s is not treated as a bearer-link page', async (path) => {
    const middleware = await loadMiddleware();
    const res = await middleware(new NextRequest(`https://app.tims.com${path}`, { headers: { host: 'app.tims.com' } }));
    expect(res.headers.get('referrer-policy')).toBeNull();
  });
});

describe('F3 — Daily call-object CSP scoped to the interview room', () => {
  const DAILY_SCRIPT_HOSTS = ['https://*.daily.co', 'https://*.dailywebrtc.com', 'https://*.dailywebrtc.net'];

  it('recognises only the room route', () => {
    expect(isDailyCallRoute('/recruitment/interviews/abc-123/room')).toBe(true);
    expect(isDailyCallRoute('/recruitment/interviews/abc-123/room/')).toBe(true);
    expect(isDailyCallRoute('/recruitment/interviews/abc-123')).toBe(false);
    expect(isDailyCallRoute('/recruitment/interviews/a/b/room')).toBe(false);
    expect(isDailyCallRoute('/recruitment/interviews/abc/room/../../../dashboard')).toBe(false);
    expect(isDailyCallRoute('/dashboard')).toBe(false);
  });

  it('production room CSP allows the Daily bundle hosts in script-src WITHOUT unsafe-eval', () => {
    const csp = buildCsp('n0nce', '/recruitment/interviews/abc/room', NO_ORIGINS, true);
    const scriptSrc = directive(csp, 'script-src').split(' ');
    for (const host of DAILY_SCRIPT_HOSTS) expect(scriptSrc).toContain(host);
    expect(scriptSrc).toContain("'nonce-n0nce'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    const connectSrc = directive(csp, 'connect-src').split(' ');
    expect(connectSrc).toContain('wss://*.dailywebrtc.com');
    expect(connectSrc).toContain('https://*.dailywebrtc.net');
  });

  it.each(['/dashboard', '/careers/acme', '/recruitment/interviews/abc', '/offers/sign/tok', '/ai-interview/tok'])(
    'production CSP for %s keeps today’s script-src (no Daily hosts)',
    (pathname) => {
      const csp = buildCsp('n0nce', pathname, NO_ORIGINS, true);
      expect(directive(csp, 'script-src')).toBe("script-src 'self' 'nonce-n0nce' https://challenges.cloudflare.com");
      expect(csp).not.toContain('dailywebrtc');
    },
  );

  it('middleware sends the relaxed policy only for the room path', async () => {
    state.user = { id: 'staff' };
    const middleware = await loadMiddleware();
    const room = await middleware(
      new NextRequest('https://app.tims.com/recruitment/interviews/abc/room', { headers: { host: 'app.tims.com' } }),
    );
    const dash = await middleware(
      new NextRequest('https://app.tims.com/dashboard', { headers: { host: 'app.tims.com' } }),
    );
    expect(directive(room.headers.get('content-security-policy') ?? '', 'script-src')).toContain(
      'https://*.dailywebrtc.com',
    );
    expect(directive(dash.headers.get('content-security-policy') ?? '', 'script-src')).not.toContain('daily');
  });
});

describe('F6 — candidate token routes are public on every host', () => {
  const HOSTS = ['app.tims.com', 'app.example.com', 'example.com', 'localhost:3000', 'tims-ats.vercel.app'];
  const TOKEN_ROUTES = [
    '/offers/sign/tok_abc',
    '/ai-interview/tok_abc',
    '/accept-invitation?token=t',
    '/careers/acme/v1',
  ];

  for (const host of HOSTS) {
    it.each(TOKEN_ROUTES)(`anonymous %s on ${host} is not bounced to /login`, async (path) => {
      const middleware = await loadMiddleware();
      const res = await middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
      expect(res.headers.get('location')).toBeNull();
    });
  }

  it.each(['app.tims.com', 'app.example.com', 'localhost:3000'])(
    'anonymous staff routes still redirect to /login on %s',
    async (host) => {
      const middleware = await loadMiddleware();
      for (const path of ['/dashboard', '/recruitment/offers', '/offers']) {
        const res = await middleware(new NextRequest(`https://${host}${path}`, { headers: { host } }));
        expect(res.headers.get('location')).toContain('/login');
      }
    },
  );

  it('public-path matching is segment-aware (a prefix look-alike is NOT public)', async () => {
    const middleware = await loadMiddleware();
    for (const path of ['/offers/signatures', '/careersadmin', '/ai-interviewer']) {
      const res = await middleware(
        new NextRequest(`https://app.tims.com${path}`, { headers: { host: 'app.tims.com' } }),
      );
      expect(res.headers.get('location')).toContain('/login');
    }
  });
});

describe('F3 — client wiring the room CSP depends on', () => {
  const ROOM = 'apps/web/app/(admin)/recruitment/interviews';

  it('creates the Daily call object with avoidEval (no unsafe-eval needed)', () => {
    const src = readFileSync(resolve(ROOM, '[id]/room/page.tsx'), 'utf8');
    expect(src).toMatch(/<DailyProvider\s+dailyConfig=\{\{\s*avoidEval:\s*true\s*\}\}>/);
  });

  it('enters the room with a full document load (plain <a>), so the room CSP is actually received', () => {
    const src = readFileSync(resolve(ROOM, 'interview-table.tsx'), 'utf8');
    expect(src).toMatch(/<a\s+href=\{`\/recruitment\/interviews\/\$\{iv\.id\}\/room`\}/);
    expect(src).not.toMatch(/<Link\s+href=\{`\/recruitment\/interviews\/\$\{iv\.id\}\/room`\}/);
  });
});

describe('F3 — leaving the room never carries its relaxed CSP (full document navigation)', () => {
  const ROOM_DIR = 'apps/web/app/(admin)/recruitment/interviews/[id]/room';
  const roomFiles = readdirSync(resolve(ROOM_DIR)).filter((f) => /\.tsx?$/.test(f));

  it.each(roomFiles)('%s has no soft-navigation primitive (router.push / next/link / useRouter)', (file) => {
    const src = readFileSync(resolve(ROOM_DIR, file), 'utf8');
    expect(src).not.toMatch(/from ['"]next\/link['"]/);
    expect(src).not.toMatch(/\buseRouter\b/);
    expect(src).not.toMatch(/\brouter\.(push|replace|back|forward)\b/);
  });

  it.each(['interview-top-bar.tsx', 'video-controls.tsx'])('%s exits via hardNavigate', (file) => {
    const src = readFileSync(resolve(ROOM_DIR, file), 'utf8');
    expect(src).toMatch(/hardNavigate\(ROOM_EXIT_PATH\)/);
  });

  it('the room layout mounts the HardExitGuard (covers admin-shell next/link + back/forward)', () => {
    const src = readFileSync(resolve(ROOM_DIR, 'layout.tsx'), 'utf8');
    expect(src).toMatch(/<HardExitGuard \/>/);
    const guard = readFileSync(resolve(ROOM_DIR, 'hard-exit-guard.tsx'), 'utf8');
    expect(guard).toMatch(/addEventListener\('click', onClick, true\)/);
    expect(guard).toMatch(/addEventListener\('popstate'/);
  });

  const base: AnchorClick = {
    href: '/dashboard',
    currentHref: 'https://app.tims.com/recruitment/interviews/abc/room',
    target: null,
    hasDownload: false,
    button: 0,
    hasModifier: false,
    defaultPrevented: false,
  };

  it('turns a plain in-app link click into a full navigation', () => {
    expect(hardExitTarget(base)).toBe('https://app.tims.com/dashboard');
    expect(hardExitTarget({ ...base, href: 'https://app.tims.com/recruitment/interviews', target: '_self' })).toBe(
      'https://app.tims.com/recruitment/interviews',
    );
  });

  it.each([
    ['new tab', { target: '_blank' }],
    ['download', { hasDownload: true }],
    ['modifier key', { hasModifier: true }],
    ['middle click', { button: 1 }],
    ['already handled', { defaultPrevented: true }],
    ['external origin', { href: 'https://docs.daily.co/x' }],
    ['same document hash', { href: '#notes' }],
  ])('leaves %s to the browser', (_label, patch) => {
    expect(hardExitTarget({ ...base, ...patch })).toBeNull();
  });
});
