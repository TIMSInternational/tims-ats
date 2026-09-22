import { NextResponse } from 'next/server';

const ACTIONS = new Set(['preview', 'register', 'complete']);
const MAX_BODY_BYTES = 8192;

/** Capability-scoped relay for invitation setup. It never forwards ambient cookies. */
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const fail = (status: number) =>
    NextResponse.json({ error: 'setup_unavailable' }, { status, headers: { 'cache-control': 'no-store' } });
  if (!ACTIONS.has(action)) return fail(404);
  const requestUrl = new URL(request.url);
  if (request.headers.get('origin') !== requestUrl.origin || request.headers.get('sec-fetch-site') === 'cross-site')
    return fail(403);
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') return fail(415);
  const configured = process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL;
  if (!configured) return fail(503);
  let upstream: URL;
  try {
    upstream = new URL(configured);
  } catch {
    return fail(503);
  }
  if (upstream.protocol !== 'https:' || upstream.username || upstream.password || upstream.search || upstream.hash)
    return fail(503);
  upstream.pathname = `/invitations/setup/${action}`;

  const reader = request.body?.getReader();
  if (!reader) return fail(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return fail(413);
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const headers = new Headers({ 'content-type': 'application/json' });
  if (action === 'complete') {
    const authorization = request.headers.get('authorization');
    if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) return fail(401);
    headers.set('authorization', authorization);
  }
  try {
    const response = await fetch(upstream, {
      method: 'POST',
      headers,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return fail(response.status);
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    return fail(503);
  }
}
