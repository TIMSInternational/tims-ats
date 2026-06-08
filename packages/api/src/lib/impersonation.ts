import { createHmac, timingSafeEqual } from 'crypto';

// ---------------------------------------------------------------------------
// Platform-owner impersonation token (HMAC-signed cookie).
//
// The token alone grants NOTHING: it is only honored when the request's REAL
// authenticated user (verified Supabase session) is a platform owner — see the
// resolution in apps/web/app/api/trpc/[trpc]/route.ts. The HMAC signature is
// defense-in-depth so the {impersonatorId, targetUserId} pair can't be tampered
// with. Short TTL; httpOnly cookie set/cleared only by the /api/impersonate
// route handlers (which re-verify platform-owner status server-side).
// ---------------------------------------------------------------------------

export const IMPERSONATION_COOKIE = 'tims_impersonation';
const TTL_MS = 60 * 60 * 1000; // 1 hour

export interface ImpersonationPayload {
  impersonatorId: string;
  targetUserId: string;
  exp: number;
}

function secretOrNull(): string | null {
  return process.env.NEXTAUTH_SECRET || null;
}

/** Sign a token. Throws if no secret is configured (fail loud at start time). */
export function signImpersonationToken(impersonatorId: string, targetUserId: string): string {
  const secret = secretOrNull();
  if (!secret) throw new Error('NEXTAUTH_SECRET not set — impersonation unavailable');
  const payload: ImpersonationPayload = { impersonatorId, targetUserId, exp: Date.now() + TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/** Verify a token. Returns null (never throws) on any problem — fail-closed so a
 *  bad/forged/expired cookie simply means "not impersonating". */
export function verifyImpersonationToken(token: string | undefined | null): ImpersonationPayload | null {
  const secret = secretOrNull();
  if (!secret || !token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as ImpersonationPayload;
    if (!payload?.impersonatorId || !payload?.targetUserId || typeof payload.exp !== 'number') return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Extract the impersonation token value from a raw Cookie header. */
export function readImpersonationCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === IMPERSONATION_COOKIE) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}
