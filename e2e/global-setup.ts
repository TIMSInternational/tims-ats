import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { readStack } from './lib/stack';

/** GET `url`, trusting only the stack's throwaway CA (never disabling TLS verification). */
function probe(url: string, ca: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { ca, timeout: 15_000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * Runs once per `playwright test`, before any worker starts:
 *   - re-asserts every stack URL is local (readStack throws otherwise);
 *   - checks the web app, the C# API and LocalStack answer, so a dead stack fails in seconds with
 *     a clear message instead of as a navigation timeout in the first spec;
 *   - mints the run id that makes every created email/slug unique (workers inherit process.env).
 */
export default async function globalSetup(): Promise<void> {
  const stack = readStack();
  const ca = readFileSync(stack.caFile);
  for (const [label, url] of [
    ['web', `${stack.baseURL}/login`],
    ['C# API', `${stack.apiURL}/health`],
  ] as const) {
    const status = await probe(url, ca).catch((e: unknown) => {
      throw new Error(`[e2e] ${label} is unreachable at ${url} (${String(e)}) — run: bash scripts/e2e/up.sh`);
    });
    if (status !== 200) throw new Error(`[e2e] ${label} at ${url} answered HTTP ${status}`);
  }
  const ls = await fetch(`${stack.localstackURL}/_localstack/health`).catch(() => undefined);
  if (!ls?.ok) throw new Error(`[e2e] LocalStack is not answering at ${stack.localstackURL}`);
  process.env.E2E_RUN_ID ??= `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}
