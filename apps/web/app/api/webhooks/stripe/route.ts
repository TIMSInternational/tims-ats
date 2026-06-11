import { handleStripeWebhook, isWebhookVerificationError } from '@tims/api';
import { logger } from '@tims/shared';
import * as Sentry from '@sentry/nextjs';

// Stripe webhook entrypoint. Reads the RAW body (required for signature
// verification) and never processes an unverified event — every verification failure
// (missing secret/header, bad signature) → 400; handler failures → 500. Stripe
// retries on non-2xx, so a transient 500 is re-delivered and re-applied idempotently.
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get('stripe-signature');
  const rawBody = await req.text();

  try {
    const result = await handleStripeWebhook(rawBody, signature);
    return Response.json(result);
  } catch (err) {
    if (isWebhookVerificationError(err)) {
      return new Response('Invalid signature', { status: 400 });
    }
    logger.error({ err }, 'stripe webhook handler failed');
    Sentry.captureException(err, { tags: { webhook: 'stripe' } });
    return Response.json({ ok: false, error: 'handler_failed' }, { status: 500 });
  }
}
