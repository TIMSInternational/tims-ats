import 'server-only';
import { RELAY_HEADER, signRelayAttribution } from './relay-attribution';

const COOKIE_NAME = 'tims_impersonation';
const MAX_BODY_BYTES = 1_048_576;

/** Fixed-upstream bearer relay. C# remains the JWT, tenant and signed-cookie authority. */
export async function proxyPlatformRequest(request: Request): Promise<Response> {
  const reject = (status: number) => Response.json({ error: 'platform_request_rejected' }, { status });
  const incoming = new URL(request.url);
  const origin = request.headers.get('origin');
  if (origin && origin !== incoming.origin) return reject(403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') return reject(403);
  const authorization = request.headers.get('authorization');
  // Never upgrade ambient Next/Supabase cookies to bearer authentication (CSRF).
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) return reject(401);
  const configured = process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL;
  if (!configured) return reject(503);
  let upstream: URL;
  try {
    upstream = new URL(configured);
  } catch {
    return reject(503);
  }
  if (
    upstream.username ||
    upstream.password ||
    upstream.search ||
    upstream.hash ||
    (upstream.protocol !== 'https:' && !(upstream.protocol === 'http:' && upstream.hostname === 'localhost'))
  ) {
    return reject(503);
  }
  const path = incoming.pathname.slice('/api/platform'.length);
  if (
    !incoming.pathname.startsWith('/api/platform/') ||
    !/^\/[A-Za-z0-9/_{}.%~-]+$/.test(path) ||
    path.includes('//') ||
    /%2f|%5c|%2e/i.test(path)
  )
    return reject(400);
  upstream.pathname = upstream.pathname.replace(/\/$/, '') + path;
  upstream.search = incoming.search;
  const headers = new Headers({ authorization, accept: 'application/json' });
  // Forward only this HttpOnly cookie, never Supabase session cookies or arbitrary headers.
  const cookies = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${COOKIE_NAME}=`));
  if (cookies.length > 1 || cookies.some((value) => value.length > 4096)) return reject(400);
  if (cookies.length === 1) headers.set('cookie', cookies[0]!);
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET') {
    if (
      request.headers.get('content-type')?.split(';')[0] !== 'application/json' &&
      request.headers.get('content-length') !== '0' &&
      request.body !== null
    )
      return reject(415);
    // Read incrementally so a dishonest/missing Content-Length cannot exhaust memory.
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel();
          return reject(413);
        }
        chunks.push(chunk.value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      body = bytes.buffer;
      headers.set('content-type', 'application/json');
    }
  }
  try {
    headers.set(RELAY_HEADER, signRelayAttribution(request, upstream, authorization, cookies[0] ?? ''));
  } catch {
    return reject(503);
  }
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    for (const name of ['content-type', 'retry-after']) {
      const value = response.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return reject(502);
  }
}
