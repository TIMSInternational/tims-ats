/**
 * Runs `task` after the response has been sent, WITHOUT the serverless runtime freezing it mid-flight.
 *
 * Why this exists (INVU pilot proof run, 2026-11-03): on Vercel a bare `void promise` started inside a
 * request handler is suspended as soon as the response is returned. The interview invitation email
 * (an SES call with an 8 s AbortSignal) was frozen and only resumed 51 s later, when the next request
 * reused the instance, so its timeout fired at once ("Failed to send raw email", AbortError) and nothing
 * was delivered. The application-confirmation email never resumed at all. `ctx.runAfterResponse` is
 * wired to Next's `after()` by the tRPC route, which keeps the function alive until the task settles.
 *
 * Outside Next (tests, scripts) `runAfterResponse` is absent and `after()` can throw when called outside
 * a request scope, so both fall back to a detached promise, as before. Never throws, and the task can
 * never reject into the runtime: a rejection is swallowed here, so tasks must do their own logging.
 */
export function runAfterResponse(
  ctx: { runAfterResponse?: (task: () => Promise<void>) => void },
  task: () => Promise<void>,
): void {
  const safe = async (): Promise<void> => {
    try {
      await task();
    } catch {
      // Swallowed by contract: the task logs its own failures (no PII here).
    }
  };
  try {
    if (ctx.runAfterResponse) {
      ctx.runAfterResponse(safe);
      return;
    }
  } catch {
    // after() outside a request scope: fall through to the detached promise.
  }
  void Promise.resolve().then(safe);
}
