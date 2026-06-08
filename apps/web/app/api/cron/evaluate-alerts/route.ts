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
    return Response.json({ ok: true, ...summary });
  } catch (err) {
    logger.error({ err }, 'cron/evaluate-alerts failed');
    Sentry.captureException(err, { tags: { cron: 'evaluate-alerts' } });
    return Response.json({ ok: false, error: 'evaluation_failed' }, { status: 500 });
  }
}
