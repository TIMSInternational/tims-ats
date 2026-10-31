import type { TRPCError, TRPCDefaultErrorShape } from '@trpc/server';
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc';

/**
 * Client-facing shaping of tRPC errors (used by the `errorFormatter` in trpc.ts).
 *
 * - In production, an INTERNAL_SERVER_ERROR (an unexpected exception: a database error, a bug) is sent with a
 *   generic message and no stack. The full error is still logged and reported to Sentry by the route's
 *   `onError` (apps/web/app/api/trpc/[trpc]/route.ts), which sees the original error, not this shape.
 * - A Prisma "record not found" (P2025 from `*OrThrow` / update / delete) is reported as NOT_FOUND (404)
 *   in every environment, with a generic message in production.
 * - Deliberate TRPCErrors with any other code (BAD_REQUEST, FORBIDDEN, …) keep their message: those
 *   messages are written for the user.
 */

export const GENERIC_INTERNAL_ERROR_MESSAGE = 'Ocurrio un error inesperado. Intenta de nuevo mas tarde.';
export const GENERIC_NOT_FOUND_MESSAGE = 'No se encontro el recurso solicitado.';

type Env = Readonly<Record<string, string | undefined>>;

/** Production when the Node build is production or the deployment is Vercel production. */
export function isProductionRuntime(env: Env = process.env): boolean {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

/** Prisma's not-found error, matched by shape so it holds across Prisma client instances/versions. */
export function isPrismaNotFoundError(cause: unknown): boolean {
  if (cause === null || typeof cause !== 'object') return false;
  const { name, code } = cause as { name?: unknown; code?: unknown };
  return name === 'NotFoundError' || (name === 'PrismaClientKnownRequestError' && code === 'P2025');
}

export function shapeClientError<S extends TRPCDefaultErrorShape>(
  shape: S,
  error: TRPCError,
  isProduction: boolean = isProductionRuntime(),
): S {
  const data = { ...shape.data };
  if (isProduction) delete data.stack;

  if (error.code === 'INTERNAL_SERVER_ERROR' && isPrismaNotFoundError(error.cause)) {
    return {
      ...shape,
      message: isProduction ? GENERIC_NOT_FOUND_MESSAGE : shape.message,
      code: TRPC_ERROR_CODES_BY_KEY.NOT_FOUND,
      data: { ...data, code: 'NOT_FOUND', httpStatus: 404 },
    };
  }

  if (!isProduction) return shape;
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    return { ...shape, message: GENERIC_INTERNAL_ERROR_MESSAGE, data };
  }
  return { ...shape, data };
}
