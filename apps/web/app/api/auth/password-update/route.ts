import { NextResponse } from 'next/server';
import { z } from 'zod';

const MAX_BODY_BYTES = 1024;
const inputSchema = z.object({
  password: z.string().min(12).max(128),
  userId: z.string().uuid(),
});
const userSchema = z.object({ id: z.string().uuid() });
const providerErrorSchema = z.object({ code: z.string().max(100) });

const fail = (status: number) =>
  NextResponse.json({ error: 'password_update_unavailable' }, { status, headers: { 'cache-control': 'no-store' } });
const requireMfa = () =>
  NextResponse.json({ error: 'mfa_required' }, { status: 403, headers: { 'cache-control': 'no-store' } });

async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  if (request.headers.get('origin') !== requestUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site')
    return fail(403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(415);
  const authorization = request.headers.get('authorization');
  if (!authorization || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization))
    return fail(401);

  const bytes = await boundedBody(request);
  if (!bytes) return fail(413);
  let input: z.infer<typeof inputSchema>;
  try {
    input = inputSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return fail(400);
  }

  const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!configuredUrl || !anonKey) return fail(503);
  let userUrl: URL;
  try {
    userUrl = new URL('/auth/v1/user', configuredUrl);
    if (userUrl.protocol !== 'https:' || userUrl.username || userUrl.password) return fail(503);
  } catch {
    return fail(503);
  }

  const headers = new Headers({ apikey: anonKey, authorization, 'content-type': 'application/json' });
  try {
    const identityResponse = await fetch(userUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    const identityText = await identityResponse.text();
    if (!identityResponse.ok || identityText.length > 65_536) return fail(401);
    const identity = userSchema.safeParse(JSON.parse(identityText));
    if (!identity.success || identity.data.id !== input.userId) return fail(403);

    const updateResponse = await fetch(userUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password: input.password }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!updateResponse.ok) {
      const providerBody = await updateResponse.text();
      if (providerBody.length <= 65_536) {
        try {
          const providerError = providerErrorSchema.safeParse(JSON.parse(providerBody));
          if (providerError.success && providerError.data.code === 'insufficient_aal') return requireMfa();
        } catch {
          // Provider errors stay private; only the allowlisted MFA signal crosses
          // this same-origin boundary.
        }
      }
      return fail(updateResponse.status);
    }
    return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } catch {
    return fail(503);
  }
}
