import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// Via packages/api's copy (the one s3.ts uses) — root tsc cannot resolve the bare specifier.
import { S3Client } from '../../packages/api/node_modules/@aws-sdk/client-s3';
import { createPresignedPost } from '../../packages/api/node_modules/@aws-sdk/s3-presigned-post';
import { NextRequest } from '../../apps/web/node_modules/next/server';
import { buildCsp, isDailyCallRoute, s3PresignedPostOrigin } from '../../apps/web/lib/security/csp';

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
    ['tims-cv-uploads', 'us-east-1'],
    ['tims-cv-uploads', 'us-west-2'],
    ['tims.cv.dotted', 'eu-west-1'],
  ])('matches the SDK presigned-POST origin for bucket %s in %s', async (bucket, region) => {
    expect(s3PresignedPostOrigin(bucket, region)).toBe(await sdkOrigin(bucket, region));
  });

  it('defaults the region to us-east-1 exactly like packages/api/src/lib/s3.ts', () => {
    expect(s3PresignedPostOrigin('tims-cv', undefined)).toBe('https://tims-cv.s3.us-east-1.amazonaws.com');
  });

  it('is empty (adds nothing) when the bucket is unset or the region is malformed', () => {
    expect(s3PresignedPostOrigin(undefined, 'us-east-1')).toBe('');
    expect(s3PresignedPostOrigin('', 'us-east-1')).toBe('');
    expect(s3PresignedPostOrigin('tims-cv', "us-east-1 'unsafe-eval'")).toBe('');
    expect(s3PresignedPostOrigin('bad bucket;', 'us-east-1')).toBe('');
  });

  it('agrees with s3.ts: CV_UPLOADS_REGION wins over AWS_REGION in both places', async () => {
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

  it('middleware adds ONLY the bucket origin — no *.amazonaws.com wildcard', async () => {
    vi.stubEnv('CV_UPLOADS_BUCKET', 'tims-cv-uploads');
    vi.stubEnv('AWS_REGION', 'us-west-2');
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
