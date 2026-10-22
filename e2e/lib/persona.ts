import { expect, type Browser, type BrowserContext, type Page, type Response } from '@playwright/test';
import type { Credentials } from './stack';

/**
 * One signed-in human. Each persona gets its own browser context (own cookies/session), the way a
 * real admin, recruiter and candidate would each use their own browser.
 */
export interface Persona {
  context: BrowserContext;
  page: Page;
  /** Which persona this is, for failure messages (e.g. 'recruiter'). */
  label: string;
  /** tRPC procedures this persona has sent (each procedure in a batched request counts once). */
  trpcCalls: number;
  /** tRPC procedures the app's per-user rate limiter refused (TOO_MANY_REQUESTS). */
  rateLimited: string[];
  /**
   * Response recorders still reading a body. A 207 batch is classified only after its JSON arrives, so
   * a check that does not wait for these can pass before a refusal is recorded (tier-1 review, #330).
   */
  pending: Set<Promise<void>>;
  /** tRPC requests sent but not yet finished or failed: a check must wait for these too (headers may not be in). */
  inFlight: Set<unknown>;
  /** tRPC 207 batches whose body could not be read, so a refusal in them can be neither ruled in nor out. */
  unclassified: string[];
}

// Third-party services the BROWSER must never reach: video (Daily), voice AI (ElevenLabs/LiveKit).
// Server-side, nothing is "unreachable": @ai-sdk/amazon-bedrock hardcodes the bedrock-runtime host
// (it ignores AWS_ENDPOINT_URL) and the ElevenLabs base URL is hardcoded too. What holds is that no
// credentials are provided (scripts/e2e/up.sh writes those keys EMPTY and env-guard.mjs refuses to
// start if a .env file would supply them) and no journey step triggers AI — so a server-side call,
// if one happened, would go out unauthenticated and fail.
const BLOCKED = /(^|\.)(daily\.co|dailywebrtc\.(com|net)|elevenlabs\.io|livekit\.cloud)$/;

const TRPC_PATH = '/api/trpc/';

/** The procedure names of a (possibly batched) tRPC request URL. */
function trpcProcedures(url: string): string[] {
  const { pathname } = new URL(url);
  const at = pathname.indexOf(TRPC_PATH);
  return at < 0 ? [] : decodeURIComponent(pathname.slice(at + TRPC_PATH.length)).split(',');
}

/**
 * Record rate-limit refusals. The app's real limiters stay on in E2E (e2e/README.md), and the tRPC one
 * is per USER: the company journey and the candidate journey drive the same recruiter, admin and leader.
 * When a journey spends a user's budget, the refused queries surface only as a list that never fills
 * (#330: a 20 s wait for an offer that was there all along) — so make the cause impossible to miss.
 */
async function recordRateLimit(persona: Persona, response: Response): Promise<void> {
  const procedures = trpcProcedures(response.url());
  if (procedures.length === 0) return;
  const status = response.status();
  if (status === 429) {
    persona.rateLimited.push(...procedures);
    return;
  }
  // A batch where only some procedures were refused answers 207 with a per-procedure result array.
  if (status !== 207) return;
  const body = await response.json().catch(() => null);
  if (!Array.isArray(body)) {
    // Never read "unknown" as "fine": surface it, so a refusal cannot hide behind a failed body read.
    persona.unclassified.push(...procedures);
    return;
  }
  body.forEach((result: unknown, i) => {
    const code = (result as { error?: { json?: { data?: { code?: unknown } } } } | null)?.error?.json?.data?.code;
    if (code === 'TOO_MANY_REQUESTS') persona.rateLimited.push(procedures[i] ?? '?');
  });
}

export async function newPersona(browser: Browser, label: string): Promise<Persona> {
  const context = await browser.newContext();
  await context.route(
    (url) => BLOCKED.test(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const page = await context.newPage();
  const persona: Persona = {
    context, page, label, trpcCalls: 0, rateLimited: [], pending: new Set(), inFlight: new Set(), unclassified: [],
  };
  context.on('request', (request) => {
    const n = trpcProcedures(request.url()).length;
    persona.trpcCalls += n;
    if (n > 0) persona.inFlight.add(request);
  });
  context.on('requestfinished', (request) => void persona.inFlight.delete(request));
  context.on('requestfailed', (request) => void persona.inFlight.delete(request));
  context.on('response', (response) => {
    const done: Promise<void> = recordRateLimit(persona, response)
      .catch(() => undefined)
      .then(() => {
        persona.pending.delete(done);
      });
    persona.pending.add(done);
  });
  return persona;
}

const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Wait until every tRPC request this persona sent has FINISHED (or failed) and every response has been
 * classified. Waiting only for responses whose headers had arrived let a late batch slip past a check or
 * a teardown (tier-1 review). Throws if requests are still outstanding after SETTLE_TIMEOUT_MS.
 */
export async function settleRecorders(...personas: (Persona | undefined)[]): Promise<void> {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  for (const p of personas) {
    while (p && (p.pending.size > 0 || p.inFlight.size > 0)) {
      if (Date.now() > deadline) {
        throw new Error(`[e2e] the ${p.label} persona still has ${p.inFlight.size} tRPC request(s) in flight; ` +
          'their rate-limit outcome is unknown, so this check refuses to pass.');
      }
      if (p.pending.size > 0) await Promise.all([...p.pending]);
      else await new Promise((r) => setTimeout(r, 25));
    }
  }
}

/**
 * Fail the current test if any persona was rate limited. Call (and await) from `test.afterEach`: a refused
 * query does not fail the step that made it — it fails a later one, as a timeout on data that never renders.
 * It first waits for in-flight recorders, so a 207 whose body is still being read is not missed.
 */
export async function expectNotRateLimited(...personas: (Persona | undefined)[]): Promise<void> {
  await settleRecorders(...personas);
  for (const p of personas) {
    if (p && p.unclassified.length > 0) {
      const unread = [...new Set(p.unclassified)].join(', ');
      p.unclassified.length = 0;
      throw new Error(`[e2e] the ${p.label} persona got a partial tRPC batch (207) whose body could not be read ` +
        `(${unread}); a TOO_MANY_REQUESTS in it can be neither ruled in nor out.`);
    }
    if (!p || p.rateLimited.length === 0) continue;
    const refused = [...new Set(p.rateLimited)].join(', ');
    p.rateLimited.length = 0; // report once, on the test where it happened
    throw new Error(
      `[e2e] the ${p.label} persona hit the app's per-user tRPC rate limit (TOO_MANY_REQUESTS on ${refused}; ` +
        `${p.trpcCalls} procedures sent by this persona so far). The journey is spending more of one user's ` +
        `per-minute query budget than the product allows — cut redundant full page loads rather than retrying.`,
    );
  }
}

/** Sign in through the real /login form (Supabase password auth). */
export async function signIn(page: Page, creds: Credentials): Promise<void> {
  await page.goto('/login');
  await page.getByPlaceholder('tu@empresa.com').fill(creds.email);
  await page.getByPlaceholder('••••••••').fill(creds.password);
  await page.getByRole('button', { name: /^iniciar sesi[oó]n$/i }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 45_000 });
}

/**
 * Close a persona's browser. Responses that were still being read when the last test's afterEach ran are
 * settled first and then checked, so a refusal at the very end of a journey cannot escape every check.
 */
export async function closePersona(p: Persona | undefined): Promise<void> {
  let unsettled: unknown;
  try {
    await settleRecorders(p);
  } catch (err) {
    unsettled = err;
  }
  await p?.context.close().catch(() => undefined);
  if (unsettled) throw unsettled;
  await expectNotRateLimited(p);
}
