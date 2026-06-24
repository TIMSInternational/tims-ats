/**
 * ElevenLabs Conversational AI integration client.
 *
 * Two responsibilities:
 *   1. getSignedUrl  — server-side only; exchanges the API key for a short-lived
 *      signed WebSocket URL so the browser can start a conversation without ever
 *      seeing the key.
 *   2. verifyWebhookSignature — validates ElevenLabs post-call webhook payloads
 *      using the documented `t=<timestamp>,v0=<hmac>` scheme.
 *
 * Webhook signature scheme (ElevenLabs documented format):
 *   Header: ElevenLabs-Signature: t=<unix-seconds>,v0=<hex-HMAC-SHA256>
 *   Signed payload: "<timestamp>.<rawBody>"
 *   Replay guard: reject events where |now − timestamp| > 30 minutes
 *   Compare: crypto.timingSafeEqual to prevent timing attacks
 *
 * References:
 *   https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
 *   https://elevenlabs.io/docs/api-reference/conversations/get-signed-url
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io';
const SIGNED_URL_PATH = '/v1/convai/conversation/get-signed-url';

/** Reject webhooks with a timestamp older / newer than 30 minutes (ElevenLabs default). */
const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 30 * 60;

// ---------------------------------------------------------------------------
// Response validation schemas
// ---------------------------------------------------------------------------

/** Minimal Zod schema for the get-signed-url response. */
const SignedUrlResponseSchema = z.object({
  /** The wss:// URL the client uses to open the WebSocket session. */
  signed_url: z.string().url(),
  /**
   * Returned only when `include_conversation_id=true` is sent.
   * Optional here so the schema validates both shapes.
   */
  conversation_id: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GetSignedUrlOptions {
  /** ElevenLabs agent id (agent_…). */
  agentId: string;
  /**
   * Dynamic variables injected into the conversation at session-init time.
   * These are NOT passed as query parameters to get-signed-url; they are
   * embedded in the wss:// URL returned, or sent as the first WebSocket
   * `conversation_initiation_client_data` message by the client SDK.
   * Stored here for callers that need to forward them to the client.
   */
  dynamicVariables: Record<string, string>;
  /** Hard cap on session duration forwarded to the client (seconds). */
  maxDurationSeconds: number;
}

export interface SignedUrlResult {
  /** wss:// URL for the browser to open the voice session. */
  signedUrl: string;
  /**
   * Conversation id, populated when ElevenLabs includes it.
   * `null` when ElevenLabs omits the field — the caller must persist `null`
   * rather than an empty string so the `@unique` DB constraint is not violated
   * by a second session that also receives no conversation id.
   */
  conversationId: string | null;
}

/**
 * Exchange the server-side API key for a short-lived signed WebSocket URL.
 *
 * Security invariant: ELEVENLABS_API_KEY is placed ONLY in the `xi-api-key`
 * request header and NEVER appears in any value returned to callers.
 *
 * Note on dynamic_variables / conversation_config_override:
 *   These are NOT query parameters of get-signed-url. They are forwarded to
 *   the client alongside the signed URL so the browser SDK can include them
 *   in the `conversation_initiation_client_data` WebSocket message.
 *   The returned `dynamicVariables` field (from the options) must be passed
 *   by the caller's tRPC procedure to the frontend — they are NOT embedded
 *   in the signed URL itself by this function.
 *
 * Throws TRPCError 'SERVICE_UNAVAILABLE' if the API key is absent or
 * ElevenLabs returns a non-OK response.
 */
export async function getSignedUrl(opts: GetSignedUrlOptions): Promise<SignedUrlResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'ElevenLabs is not configured on this server',
    });
  }

  const url = new URL(SIGNED_URL_PATH, ELEVENLABS_API_BASE);
  url.searchParams.set('agent_id', opts.agentId);
  // Request that ElevenLabs include a conversation_id in the response so we
  // can correlate post-call webhook events back to this session.
  url.searchParams.set('include_conversation_id', 'true');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      // API key is confined to the server-side request header — never in a
      // return value or query parameter.
      'xi-api-key': apiKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: `ElevenLabs get-signed-url failed: ${response.status} ${response.statusText}`,
    });
  }

  const raw: unknown = await response.json();
  const parsed = SignedUrlResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'SERVICE_UNAVAILABLE',
      message: 'ElevenLabs returned an unexpected response shape',
    });
  }

  return {
    signedUrl: parsed.data.signed_url,
    // Use null when ElevenLabs omits conversation_id. Callers must persist null
    // (not '') so that the @unique DB constraint is not violated when a second
    // session also receives no conversation id — Postgres unique constraints
    // allow multiple NULL values, whereas duplicate '' would cause P2002.
    conversationId: parsed.data.conversation_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify an ElevenLabs post-call webhook signature.
 *
 * Expected header format (ElevenLabs documented scheme):
 *   ElevenLabs-Signature: t=<unix-seconds>,v0=<hex-HMAC-SHA256>
 *
 * The HMAC is computed over "<timestamp>.<rawBody>" using the webhook secret.
 * We also enforce a 30-minute replay guard on the timestamp.
 *
 * Returns false (fail-closed) for ANY of:
 *   - ELEVENLABS_WEBHOOK_SECRET not set
 *   - signatureHeader is null / missing
 *   - header cannot be parsed as `t=…,v0=…`
 *   - timestamp is absent or outside the 30-minute window
 *   - HMAC does not match (timing-safe compare)
 *
 * Mirrors the pattern in packages/api/src/lib/impersonation.ts: use
 * createHmac + timingSafeEqual; never short-circuit before the comparison.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  // Parse "t=<ts>,v0=<hex>" — order may vary, use key-based extraction.
  const parts = parseSignatureHeader(signatureHeader);
  if (!parts) return false;

  const { timestamp, v0 } = parts;

  // Replay guard: |now − timestamp| must be within tolerance.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) return false;

  // Recompute HMAC over "<timestamp>.<rawBody>".
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');

  // Timing-safe comparison: pad to equal length before comparing to avoid
  // length-timing leaks (same pattern as impersonation.ts).
  const a = Buffer.from(v0, 'hex');
  const b = Buffer.from(expected, 'hex');
  // If either buffer is empty or lengths differ (malformed hex), fail closed.
  if (a.length === 0 || a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ParsedSignatureHeader {
  timestamp: number;
  v0: string;
}

/**
 * Parse the ElevenLabs-Signature header value.
 * Accepts any ordering of the comma-separated key=value pairs.
 * Returns null if required keys are missing or timestamp is not a valid integer.
 */
function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  const pairs = header.split(',');
  let timestamp: number | undefined;
  let v0: string | undefined;

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();

    if (key === 't') {
      const parsed = parseInt(val, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      timestamp = parsed;
    } else if (key === 'v0') {
      if (val.length === 0) return null;
      v0 = val;
    }
  }

  if (timestamp === undefined || v0 === undefined) return null;
  return { timestamp, v0 };
}
