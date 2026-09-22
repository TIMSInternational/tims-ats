import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  isPasswordSetupProof,
  isSupabaseUserId,
  PASSWORD_SETUP_PROOF_COOKIE,
  PASSWORD_SETUP_PROOF_PATH,
} from '../../../../lib/password-setup-proof';

export async function POST(request: Request) {
  const nonce = new URL(request.url).searchParams.get('nonce');
  const expected =
    request.headers
      .get('cookie')
      ?.split(';')
      .map((entry) => entry.trim().split('='))
      .find(([name]) => name === PASSWORD_SETUP_PROOF_COOKIE)
      ?.slice(1)
      .join('=') ?? null;
  const separator = expected?.indexOf('.') ?? -1;
  const expectedProof = separator > 0 ? expected!.slice(0, separator) : null;
  const expectedUserId = separator > 0 ? expected!.slice(separator + 1) : null;
  const valid =
    isPasswordSetupProof(nonce) &&
    isPasswordSetupProof(expectedProof) &&
    isSupabaseUserId(expectedUserId) &&
    timingSafeEqual(Buffer.from(nonce), Buffer.from(expectedProof));
  const response = NextResponse.json({ valid, userId: valid ? expectedUserId : null }, { status: valid ? 200 : 401 });
  response.headers.set('cache-control', 'no-store');
  response.cookies.set(PASSWORD_SETUP_PROOF_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: PASSWORD_SETUP_PROOF_PATH,
    maxAge: 0,
  });
  return response;
}
