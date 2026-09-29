import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({
  platformPostRaw: post,
  isPlatformApiEnabled: () => true,
}));

const route = { orgSlug: 'test-org', assignmentId: '00000000-0000-4000-8000-000000000001' };
const origin = 'https://bucket.s3.us-west-2.amazonaws.com';

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN', origin);
  vi.resetModules();
  post.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('candidate signed media API', () => {
  it('requires a separate media-consent acknowledgement', async () => {
    const api = await import('../../apps/web/lib/platform-api/proctoring');
    post.mockResolvedValue({ accepted: true, consentVersion: 'media-v1' });
    await expect(api.consentCandidateProctoringMedia(route)).resolves.toEqual({ accepted: true, consentVersion: 'media-v1' });
    expect(post).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/media-consent',
      { accepted: true }, route,
    );
    post.mockResolvedValueOnce({ accepted: false, consentVersion: 'media-v1' });
    await expect(api.consentCandidateProctoringMedia(route)).rejects.toThrow();
  });

  it('records a candidate stop through the authoritative API', async () => {
    const api = await import('../../apps/web/lib/platform-api/proctoring');
    post.mockResolvedValueOnce({ stopped: true });
    await expect(api.stopCandidateProctoringMedia(route)).resolves.toEqual({ stopped: true });
    expect(post).toHaveBeenCalledWith(
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/media-stop', {}, route,
    );
  });

  it('sends the same client capture ID to intent and confirms the returned evidence ID', async () => {
    const api = await import('../../apps/web/lib/platform-api/proctoring');
    post.mockResolvedValueOnce({
      evidenceId: '00000000-0000-4000-8000-000000000002', status: 'intent',
      intentExpiresAt: '2026-09-24T10:10:00Z', uploadUrl: `${origin}/`, uploadFields: { key: 'staging/key' },
    }).mockResolvedValueOnce({
      evidenceId: '00000000-0000-4000-8000-000000000002', status: 'ready', expiresAt: '2026-10-01T10:00:00Z',
    });
    await api.createCandidateProctoringMediaIntent({
      ...route, clientCaptureId: '00000000-0000-4000-8000-000000000003',
      mediaType: 'camera', captureReason: 'periodic', contentType: 'image/jpeg',
    });
    await api.confirmCandidateProctoringMedia({ ...route, evidenceId: '00000000-0000-4000-8000-000000000002' });
    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/media-intents',
      '/candidate/{orgSlug}/assessments/{assignmentId}/proctoring/media-confirm',
    ]);
    expect(post.mock.calls[0]?.[1]).toMatchObject({
      clientCaptureId: '00000000-0000-4000-8000-000000000003', mediaType: 'camera',
    });
    expect(post.mock.calls[1]?.[1]).toEqual({ evidenceId: '00000000-0000-4000-8000-000000000002' });
  });

  it('posts signed fields with file last and surfaces denied S3 uploads', async () => {
    const api = await import('../../apps/web/lib/platform-api/proctoring');
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    vi.stubGlobal('fetch', fetch);
    const image = new Blob(['jpeg'], { type: 'image/jpeg' });
    await expect(api.postCandidateProctoringMedia(`${origin}/`, { key: 'staging/key', policy: 'signed' }, image))
      .rejects.toThrow('media_upload_failed');
    const [url, options] = fetch.mock.calls[0]!;
    expect(url).toBe(`${origin}/`);
    expect(options).toMatchObject({ method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'error' });
    expect([...((options as RequestInit).body as FormData).keys()]).toEqual(['key', 'policy', 'file']);
  });

  it('rejects other origins, query tricks, and missing configured origin before fetch', async () => {
    const api = await import('../../apps/web/lib/platform-api/proctoring');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const image = new Blob(['jpeg'], { type: 'image/jpeg' });
    for (const url of [
      'https://attacker.example.com/',
      `${origin}/?redirect=https://attacker.example.com`,
      'http://bucket.s3.us-west-2.amazonaws.com/',
    ]) {
      await expect(api.postCandidateProctoringMedia(url, { key: 'staging/key' }, image)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_PROCTORING_EVIDENCE_S3_ORIGIN', '');
    vi.resetModules();
    const off = await import('../../apps/web/lib/platform-api/proctoring');
    expect(off.isMediaEvidenceUploadConfigured()).toBe(false);
    await expect(off.postCandidateProctoringMedia(`${origin}/`, { key: 'staging/key' }, image))
      .rejects.toThrow('media_upload_not_configured');
  });
});
