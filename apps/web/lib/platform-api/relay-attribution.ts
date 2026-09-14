import 'server-only';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

export const RELAY_HEADER = 'x-tims-relay-attribution';
const PURPOSE = 'tims-platform-relay-attribution-v1\n';

/** Vercel overwrites x-real-ip; raw development/custom-host headers are not evidence. */
export function signRelayAttribution(request: Request, upstream: URL, authorization: string, cookie: string): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('Platform relay signing is unavailable');
  const claimedIp = process.env.VERCEL === '1' ? request.headers.get('x-real-ip')?.trim() : undefined;
  const ip = claimedIp && isIP(claimedIp) ? claimedIp : null;
  const ua = (request.headers.get('user-agent') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const payload = Buffer.from(
    JSON.stringify({
      timestamp: Math.floor(Date.now() / 1000),
      nonce: randomUUID(),
      method: request.method,
      path: upstream.pathname + upstream.search,
      authorizationHash: hash(authorization),
      cookieHash: hash(cookie),
      ip,
      ua,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(PURPOSE + payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}
