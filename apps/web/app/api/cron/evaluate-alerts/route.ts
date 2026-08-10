import { evaluateAlertRules } from '@tims/api';
import { logger } from '@tims/shared';
import * as Sentry from '@sentry/nextjs';

// Vercel Cron entrypoint — evaluates every active alert rule across all orgs and
// fires (dedup'd) alerts for breaches. Scheduled in apps/web/vercel.json.
//
// Auth is FAIL-CLOSED: requires `Authorization: Bearer <CRON_SECRET>`. Vercel adds
// exactly this header to cron invocations when the CRON_SECRET env var is set. If
// CRON_SECRET is unset, or the header doesn't match, we 401 — an unprotected cron
// endpoint that mutates the DB is never allowed.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get('authorization');
  if (!secret || provided !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const summary = await evaluateAlertRules();

    // A run where rules were SKIPPED is not a healthy run, and until now it looked like one: skipped
    // failures are per-rule `logger.error` calls and the route still returned `ok: true`. That is the
    // shape a broken cutover takes (#172) — flag on while the C# surface is dark ⇒ 404, wrong secret ⇒
    // 401, platform outage ⇒ 500 — where EVERY routed metric throws, every rule is skipped, and the
    // cron reports success. Fail-loud inside the process is worth nothing if it is silent to operators.
    if (summary.skipped > 0) {
      Sentry.captureMessage('cron/evaluate-alerts: rules skipped', {
        level: summary.skipped === summary.rules ? 'error' : 'warning',
        tags: { cron: 'evaluate-alerts' },
        extra: { rules: summary.rules, fired: summary.fired, skipped: summary.skipped },
      });
    }

    return Response.json({ ok: true, ...summary });
  } catch (err) {
    logger.error({ err }, 'cron/evaluate-alerts failed');
    Sentry.captureException(err, { tags: { cron: 'evaluate-alerts' } });
    return Response.json({ ok: false, error: 'evaluation_failed' }, { status: 500 });
  }
}
