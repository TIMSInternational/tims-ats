import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: async () => body,
  } as Response;
}

describe('videoService Daily.co runtime config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports unconfigured when DAILY_API_KEY is missing or blank', async () => {
    const { videoService } = await import('../../packages/api/src/services/video.service');

    vi.stubEnv('DAILY_API_KEY', '');
    expect(videoService.isConfigured()).toBe(false);

    vi.stubEnv('DAILY_API_KEY', '   ');
    expect(videoService.isConfigured()).toBe(false);
  });

  it('fails closed before network when DAILY_API_KEY is absent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { videoService } = await import('../../packages/api/src/services/video.service');

    await expect(
      videoService.createRoom('11111111-2222-3333-4444-555555555555'),
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a private Daily room using DAILY_API_URL when configured', async () => {
    vi.stubEnv('DAILY_API_KEY', 'daily_test_key');
    vi.stubEnv('DAILY_API_URL', 'https://daily.example.test/v1/');
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        name: 'tims-11111111',
        url: 'https://example.daily.co/tims-11111111',
        privacy: 'private',
        config: {},
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { videoService } = await import('../../packages/api/src/services/video.service');
    const room = await videoService.createRoom('11111111-2222-3333-4444-555555555555');

    expect(room).toEqual({
      roomName: 'tims-11111111',
      url: 'https://example.daily.co/tims-11111111',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://daily.example.test/v1/rooms/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer daily_test_key' }),
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      name: 'tims-11111111',
      privacy: 'private',
      properties: {
        enable_chat: true,
        enable_knocking: false,
      },
    });
    expect(typeof body.properties.exp).toBe('number');
  });

  it('reuses an existing room when Daily reports duplicate room creation', async () => {
    vi.stubEnv('DAILY_API_KEY', 'daily_test_key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: 'room already exists' }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          name: 'tims-11111111',
          url: 'https://example.daily.co/tims-11111111',
          privacy: 'private',
          config: {},
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const { videoService } = await import('../../packages/api/src/services/video.service');
    await expect(
      videoService.createRoom('11111111-2222-3333-4444-555555555555'),
    ).resolves.toMatchObject({ roomName: 'tims-11111111' });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.daily.co/v1/rooms/tims-11111111',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('maps invalid Daily credentials to PRECONDITION_FAILED instead of an opaque 500', async () => {
    vi.stubEnv('DAILY_API_KEY', 'bad_key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'authentication-error' })));

    const { videoService } = await import('../../packages/api/src/services/video.service');

    await expect(
      videoService.createRoom('11111111-2222-3333-4444-555555555555'),
    ).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: expect.stringContaining('Daily.co rechazo'),
    });
  });

  it('creates scoped meeting tokens for the resolved room', async () => {
    vi.stubEnv('DAILY_API_KEY', 'daily_test_key');
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { token: 'meeting-token' }));
    vi.stubGlobal('fetch', fetchMock);

    const { videoService } = await import('../../packages/api/src/services/video.service');

    await expect(videoService.createMeetingToken('room-1', 'Laura Garcia', true)).resolves.toBe('meeting-token');
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      properties: {
        room_name: 'room-1',
        user_name: 'Laura Garcia',
        is_owner: true,
      },
    });
    expect(typeof body.properties.exp).toBe('number');
  });
});
