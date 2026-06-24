/**
 * ElevenLabs post-call webhook entrypoint.
 *
 * Reads the RAW request body (required for HMAC signature verification) BEFORE
 * any JSON.parse. A 401 is returned for any verification failure. Handler errors
 * return a generic 500 message — stack traces and internal state are NEVER leaked.
 *
 * Idempotency: duplicate deliveries (same conversation_id, session already completed)
 * are silently accepted and return 200. ElevenLabs retries on non-2xx.
 *
 * Signature scheme (ElevenLabs documented format):
 *   Header: ElevenLabs-Signature: t=<unix-seconds>,v0=<hex-HMAC-SHA256>
 *   Signed payload: "<timestamp>.<rawBody>"
 *   Replay guard: reject events outside the configured tolerance window.
 */

import { z } from 'zod';
import { logger } from '@tims/shared';
import { verifyWebhookSignature, aiInterviewService } from '@tims/api';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Payload schema — ElevenLabs post-call webhook shape.
// Field names follow the ElevenLabs API specification.
// ---------------------------------------------------------------------------

const TranscriptTurnSchema = z.object({
  // ElevenLabs role values are short identifiers (e.g. "agent", "user").
  role: z.string().max(64),
  // Practical max per-turn: a very long AI response; 20 000 chars is generous.
  message: z.string().max(20_000),
});

const WebhookPayloadSchema = z.object({
  conversation_id: z.string(),
  // 2 000 turns is far beyond any real interview; prevents memory exhaustion.
  transcript: z.array(TranscriptTurnSchema).max(2_000),
  // Max 24 hours (86 400 s) — prevents absurd cost calculations.
  call_duration_secs: z.number().int().nonnegative().max(86_400),
  // URL max 2 048 chars (RFC 2616 / CDN limits).
  recording_url: z.string().url().max(2_048).optional(),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // RAW body read MUST happen before any JSON.parse — the HMAC is computed over
  // the exact bytes ElevenLabs sent, and req.json() would consume the body stream.
  const raw = await req.text();
  const sig = req.headers.get('ElevenLabs-Signature');

  if (!verifyWebhookSignature(raw, sig)) {
    return new Response('invalid signature', { status: 401 });
  }

  try {
    const parsed = WebhookPayloadSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      // Malformed payload from ElevenLabs — log and accept (200) to avoid
      // triggering unnecessary retries for unexpected payload shapes.
      logger.warn({ issues: parsed.error.issues }, 'elevenlabs webhook: unexpected payload shape');
      return new Response('ok', { status: 200 });
    }

    const { conversation_id, transcript, call_duration_secs, recording_url } = parsed.data;

    await aiInterviewService.processPostCallWebhook({
      conversationId: conversation_id,
      transcript,
      durationSeconds: call_duration_secs,
      audioUrl: recording_url,
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    logger.error({ err }, 'elevenlabs webhook: handler failed');
    return new Response('handler error', { status: 500 });
  }
}
