import { NextResponse } from 'next/server';
import { RELAY_HEADER, signRelayAttribution } from '../../../lib/platform-api/relay-attribution';
import { interviewJoinResultSchema, isValidInterviewJoinToken } from '../../../lib/interview-join';

const MAX_BODY_BYTES = 1024;
const UPSTREAM_PATH = '/interviews/candidate-join';

/**
 * Capability-scoped relay for the candidate video-interview join (WP-H). Same-origin only, never forwards
 * ambient cookies, signs the client attribution so the platform API can rate-limit per client IP, and
 * re-validates the upstream answer so nothing beyond the documented outcome shape reaches the browser.
 */
export async function POST(request: Request) {
  const noStore = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' };
  const fail = (status: number) => NextResponse.json({ error: 'join_unavailable' }, { status, headers: noStore });
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
  upstream.pathname = UPSTREAM_PATH;

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
  const raw = new TextDecoder().decode(Buffer.concat(chunks));
  let token: unknown;
  try {
    const parsed: unknown = JSON.parse(raw);
    token =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 1
        ? (parsed as { token?: unknown }).token
        : undefined;
  } catch {
    return fail(400);
  }
  if (!isValidInterviewJoinToken(token)) return fail(400);

  const headers = new Headers({ 'content-type': 'application/json' });
  try {
    headers.set(RELAY_HEADER, signRelayAttribution(request, upstream, '', ''));
    const response = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify({ token }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
    if (response.status === 429) return fail(429);
    if (!response.ok) return fail(response.status === 404 ? 503 : 502);
    const result = interviewJoinResultSchema.safeParse(await response.json());
    if (!result.success) return fail(502);
    return NextResponse.json(result.data, { status: 200, headers: noStore });
  } catch {
    return fail(503);
  }
}
