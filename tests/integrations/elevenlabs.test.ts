/**
 * Tests for ElevenLabs integration client + config gate.
 *
 * HMAC scheme implemented: ElevenLabs documented `t=<timestamp>,v0=<hmac>` format
 * where the HMAC is SHA-256 over "<timestamp>.<rawBody>" using the webhook secret.
 * Timestamp must be within 30 minutes of now; comparison is timing-safe.
 *
 * The brief's illustrative test used a simplified `hex(HMAC-SHA256(secret, body))`
 * scheme. These tests use the REAL ElevenLabs scheme (timestamped, t=,v0=) to match
 * the actual implementation. See task-2-report.md §HMAC Scheme for rationale.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers — re-implement wire format for test fixture construction
// ---------------------------------------------------------------------------

/** Build a valid ElevenLabs-Signature header value for a given body and secret. */
function buildSignatureHeader(body: string, secret: string, timestampOverride?: number): string {
  const ts = timestampOverride ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${body}`;
  const hmac = createHmac('sha256', secret).update(signedPayload).digest('hex');
  return `t=${ts},v0=${hmac}`;
}

// ---------------------------------------------------------------------------
// Module reset between tests (env stubs mutate module state via process.env)
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// verifyWebhookSignature
// ---------------------------------------------------------------------------

describe('verifyWebhookSignature', () => {
  const SECRET = 'whsec_test';
  const BODY = JSON.stringify({ type: 'post_call', conversationId: 'c1' });

  it('accepts a correctly-signed body', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    const header = buildSignatureHeader(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, header)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    const header = buildSignatureHeader(BODY, SECRET);
    expect(verifyWebhookSignature(BODY + 'x', header)).toBe(false);
  });

  it('rejects a null header (missing)', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    expect(verifyWebhookSignature(BODY, null)).toBe(false);
  });

  it('rejects a header signed with the wrong secret', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    const header = buildSignatureHeader(BODY, 'attacker-secret');
    expect(verifyWebhookSignature(BODY, header)).toBe(false);
  });

  it('rejects when ELEVENLABS_WEBHOOK_SECRET is not set (fail-closed)', async () => {
    // do NOT stub ELEVENLABS_WEBHOOK_SECRET
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    const header = buildSignatureHeader(BODY, SECRET);
    expect(verifyWebhookSignature(BODY, header)).toBe(false);
  });

  it('rejects a replay: timestamp outside 30-minute window', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    // 31 minutes in the past
    const staleTs = Math.floor(Date.now() / 1000) - 31 * 60;
    const header = buildSignatureHeader(BODY, SECRET, staleTs);
    expect(verifyWebhookSignature(BODY, header)).toBe(false);
  });

  it('rejects a malformed header (no t= or v0=)', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    expect(verifyWebhookSignature(BODY, 'just-a-random-string')).toBe(false);
    expect(verifyWebhookSignature(BODY, '')).toBe(false);
  });

  it('rejects a header with only t= but no v0=', async () => {
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', SECRET);
    const { verifyWebhookSignature } = await import(
      '../../packages/api/src/integrations/elevenlabs'
    );
    const ts = Math.floor(Date.now() / 1000);
    expect(verifyWebhookSignature(BODY, `t=${ts}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isElevenLabsConfigured
// ---------------------------------------------------------------------------

describe('isElevenLabsConfigured', () => {
  it('returns true when all three env vars are set', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'key');
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_abc');
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', 'secret');
    const { isElevenLabsConfigured } = await import('../../packages/api/src/lib/elevenlabs');
    expect(isElevenLabsConfigured()).toBe(true);
  });

  it('returns false when API key is missing', async () => {
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_abc');
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', 'secret');
    const { isElevenLabsConfigured } = await import('../../packages/api/src/lib/elevenlabs');
    expect(isElevenLabsConfigured()).toBe(false);
  });

  it('returns false when agent id is missing', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'key');
    vi.stubEnv('ELEVENLABS_WEBHOOK_SECRET', 'secret');
    const { isElevenLabsConfigured } = await import('../../packages/api/src/lib/elevenlabs');
    expect(isElevenLabsConfigured()).toBe(false);
  });

  it('returns false when webhook secret is missing', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'key');
    vi.stubEnv('ELEVENLABS_AGENT_ID', 'agent_abc');
    const { isElevenLabsConfigured } = await import('../../packages/api/src/lib/elevenlabs');
    expect(isElevenLabsConfigured()).toBe(false);
  });

  it('returns false when all vars are absent', async () => {
    const { isElevenLabsConfigured } = await import('../../packages/api/src/lib/elevenlabs');
    expect(isElevenLabsConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getSignedUrl
// ---------------------------------------------------------------------------

describe('getSignedUrl', () => {
  const API_KEY = 'sk_eleven_test';
  const AGENT_ID = 'agent_abc123';
  const SIGNED_URL = 'wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_abc123&conversation_signature=tok';
  const CONVERSATION_ID = 'conv_xyz789';

  it('returns signedUrl and conversationId on success', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', API_KEY);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ signed_url: SIGNED_URL, conversation_id: CONVERSATION_ID }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    const result = await getSignedUrl({
      agentId: AGENT_ID,
      dynamicVariables: { candidate_name: 'Alice', job_title: 'Engineer' },
      maxDurationSeconds: 1800,
    });

    expect(result.signedUrl).toBe(SIGNED_URL);
    expect(result.conversationId).toBe(CONVERSATION_ID);

    // --- Security invariant: API key must NOT appear in the returned URL ---
    expect(result.signedUrl).not.toContain(API_KEY);
    expect(result.conversationId).not.toContain(API_KEY);

    // API key must be in the request header, never the URL
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).not.toContain(API_KEY);
    expect((calledInit.headers as Record<string, string>)['xi-api-key']).toBe(API_KEY);

    mockFetch.mockRestore();
  });

  it('passes agent_id as a query parameter in the request URL', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', API_KEY);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ signed_url: SIGNED_URL, conversation_id: CONVERSATION_ID }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    await getSignedUrl({ agentId: AGENT_ID, dynamicVariables: {}, maxDurationSeconds: 600 });

    const [calledUrl] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toContain(`agent_id=${AGENT_ID}`);

    mockFetch.mockRestore();
  });

  it('throws SERVICE_UNAVAILABLE on non-OK HTTP response', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', API_KEY);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401, statusText: 'Unauthorized' }),
    );

    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    await expect(
      getSignedUrl({ agentId: AGENT_ID, dynamicVariables: {}, maxDurationSeconds: 600 }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    mockFetch.mockRestore();
  });

  it('throws SERVICE_UNAVAILABLE when API key is not configured', async () => {
    // no ELEVENLABS_API_KEY stub
    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    await expect(
      getSignedUrl({ agentId: AGENT_ID, dynamicVariables: {}, maxDurationSeconds: 600 }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('throws SERVICE_UNAVAILABLE when ElevenLabs returns an unexpected response shape', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', API_KEY);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ unexpected_field: 'oops' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    await expect(
      getSignedUrl({ agentId: AGENT_ID, dynamicVariables: {}, maxDurationSeconds: 600 }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    mockFetch.mockRestore();
  });

  it('handles a response without conversation_id gracefully', async () => {
    vi.stubEnv('ELEVENLABS_API_KEY', API_KEY);

    const mockFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ signed_url: SIGNED_URL }), // no conversation_id
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { getSignedUrl } = await import('../../packages/api/src/integrations/elevenlabs');
    const result = await getSignedUrl({ agentId: AGENT_ID, dynamicVariables: {}, maxDurationSeconds: 600 });
    expect(result.signedUrl).toBe(SIGNED_URL);
    expect(result.conversationId).toBeNull();

    mockFetch.mockRestore();
  });
});
