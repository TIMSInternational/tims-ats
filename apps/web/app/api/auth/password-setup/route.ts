import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  isPasswordSetupProof,
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
  const valid =
    isPasswordSetupProof(nonce) &&
    isPasswordSetupProof(expected) &&
    timingSafeEqual(Buffer.from(nonce), Buffer.from(expected));
  const response = NextResponse.json({ valid }, { status: valid ? 200 : 401 });
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
