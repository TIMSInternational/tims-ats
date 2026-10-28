import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { fetchRequestHandler } from '../../packages/api/node_modules/@trpc/server/adapters/fetch';

// The REAL errorFormatter in packages/api/src/trpc.ts, exercised over HTTP through the same fetch adapter
// the Next route uses. INTERNAL_SERVER_ERROR text never reaches clients in production; Prisma not-found
// becomes NOT_FOUND; deliberate errors keep their user-facing message.

vi.mock('@tims/db', () => ({ db: {}, runWithTenant: vi.fn() }));

const PRISMA_TEXT = 'Invalid `prisma.auditLog.findFirstOrThrow()` invocation: No record was found for a query.';

class PrismaClientKnownRequestError extends Error {
  code = 'P2025';
  constructor(message: string) {
    super(message);
    this.name = 'PrismaClientKnownRequestError';
  }
}

async function call(path: string, env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const { router, publicProcedure } = await import('../../packages/api/src/trpc');
  const appRouter = router({
    crash: publicProcedure.query(() => {
      throw new Error(`connect ECONNREFUSED 10.0.0.5:5432 — ${PRISMA_TEXT}`);
    }),
    notFound: publicProcedure.query(() => {
      throw new PrismaClientKnownRequestError(PRISMA_TEXT);
    }),
    forbidden: publicProcedure.query(() => {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'No tienes permiso para esta accion' });
    }),
    badRequest: publicProcedure.query(() => {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La fecha de inicio debe ser anterior' });
    }),
  });
  const res = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: new Request(`http://localhost/api/trpc/${path}`, { headers: { 'x-real-ip': `198.51.100.${Math.floor(Math.random() * 250)}` } }),
    router: appRouter,
    createContext: () => ({ user: null, headers: new Headers({ 'x-real-ip': '198.51.100.1' }), supabaseAuth: null, externalAuth: null }) as never,
  });
  // superjson transformer: the serialized error sits under `error.json`.
  const body = (await res.json()) as {
    error: { json: { message: string; data: { code: string; httpStatus: number; stack?: string } } };
  };
  return { status: res.status, error: body.error.json };
}

const PROD = { NODE_ENV: 'production', VERCEL_ENV: 'production', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };
const DEV = { NODE_ENV: 'development', VERCEL_ENV: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' };

describe('tRPC errorFormatter — client-facing error text', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('production: an unexpected error returns a generic message, no internal text, no stack', async () => {
    const { status, error } = await call('crash', PROD);
    expect(status).toBe(500);
    expect(error.data.code).toBe('INTERNAL_SERVER_ERROR');
    expect(error.message).not.toContain('prisma');
    expect(error.message).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(error)).not.toContain('10.0.0.5');
    expect(error.data.stack).toBeUndefined();
  });

  it('Vercel production is production even if NODE_ENV says otherwise', async () => {
    const { error } = await call('crash', { ...DEV, VERCEL_ENV: 'production' });
    expect(JSON.stringify(error)).not.toContain('ECONNREFUSED');
    expect(error.data.stack).toBeUndefined();
  });

  it('development: the internal message is kept for debugging', async () => {
    const { status, error } = await call('crash', DEV);
    expect(status).toBe(500);
    expect(error.message).toContain('ECONNREFUSED');
  });

  it('Prisma not-found (P2025) becomes NOT_FOUND / 404 with a generic message in production', async () => {
    const { status, error } = await call('notFound', PROD);
    expect(status).toBe(404);
    expect(error.data.code).toBe('NOT_FOUND');
    expect(error.data.httpStatus).toBe(404);
    expect(error.message).not.toContain('prisma');
  });

  it('Prisma not-found is NOT_FOUND in development too', async () => {
    const { status, error } = await call('notFound', DEV);
    expect(status).toBe(404);
    expect(error.data.code).toBe('NOT_FOUND');
  });

  it.each([
    ['forbidden', 403, 'FORBIDDEN', 'No tienes permiso para esta accion'],
    ['badRequest', 400, 'BAD_REQUEST', 'La fecha de inicio debe ser anterior'],
  ] as const)('deliberate %s errors keep their message in production', async (path, httpStatus, code, message) => {
    const { status, error } = await call(path, PROD);
    expect(status).toBe(httpStatus);
    expect(error.data.code).toBe(code);
    expect(error.message).toBe(message);
    expect(error.data.stack).toBeUndefined();
  });
});
