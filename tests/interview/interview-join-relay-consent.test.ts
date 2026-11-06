import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../apps/web/app/api/interview-join/route';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://api.example.test');
  vi.stubEnv('NEXTAUTH_SECRET', 'relay-test-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function input(body: unknown) {
  return new Request('https://app.example.test/api/interview-join', {
    method: 'POST',
    headers: { origin: 'https://app.example.test', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('candidate join relay — transcription decision', () => {
  it('forwards exactly the validated decision and relays consent_required with its version', async () => {
    fetchMock.mockResolvedValue(Response.json({ outcome: 'consent_required', consentVersion: 'v1' }));
    const decided = { token: TOKEN, recordingConsent: 'accepted', consentVersion: 'v1' };
    const response = await POST(input(decided));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: 'consent_required', consentVersion: 'v1' });
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual(decided);
  });

  it('rejects a decision body with anything extra before contacting the platform', async () => {
    const response = await POST(input({ token: TOKEN, recordingConsent: 'accepted', consentVersion: 'v1', org: 'x' }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an upstream answer carrying fields the page never expects', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ outcome: 'ready', joinUrl: 'https://t.daily.co/r', candidateName: 'Ana' }),
    );
    expect((await POST(input({ token: TOKEN }))).status).toBe(502);
  });
});
