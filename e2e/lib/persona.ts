import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { Credentials } from './stack';

/**
 * One signed-in human. Each persona gets its own browser context (own cookies/session), the way a
 * real admin, recruiter and candidate would each use their own browser.
 */
export interface Persona {
  context: BrowserContext;
  page: Page;
}

// Third-party services the suite must never reach, even by accident: video (Daily), voice AI
// (ElevenLabs/LiveKit). The web app's own AI calls go through the server with no credentials and
// its AWS endpoint pointed at LocalStack (scripts/e2e/up.sh), so Bedrock is unreachable there too.
const BLOCKED = /(^|\.)(daily\.co|dailywebrtc\.(com|net)|elevenlabs\.io|livekit\.cloud)$/;

export async function newPersona(browser: Browser): Promise<Persona> {
  const context = await browser.newContext();
  await context.route(
    (url) => BLOCKED.test(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  return { context, page };
}

/** Sign in through the real /login form (Supabase password auth). */
export async function signIn(page: Page, creds: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('tu@empresa.com').fill(creds.email);
  await page.getByPlaceholder('••••••••').fill(creds.password);
  await page.getByRole('button', { name: /^iniciar sesi[oó]n$/i }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 45_000 });
}

export async function closePersona(p: Persona | undefined): Promise<void> {
  await p?.context.close().catch(() => undefined);
}
