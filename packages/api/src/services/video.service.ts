// ---------------------------------------------------------------------------
// Video Service — Daily.co integration for interview video rooms
// Creates private rooms and scoped meeting tokens via Daily REST API
// ---------------------------------------------------------------------------

import { TRPCError } from '@trpc/server';

const DEFAULT_DAILY_API_BASE = 'https://api.daily.co/v1';

function dailyApiBase(): string {
  return (process.env.DAILY_API_URL || DEFAULT_DAILY_API_BASE).replace(/\/$/, '');
}

function dailyApiKey(): string | null {
  const key = process.env.DAILY_API_KEY?.trim();
  return key || null;
}

function assertConfigured(): { apiBase: string; apiKey: string } {
  const apiKey = dailyApiKey();
  if (!apiKey) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'La sala de video no esta configurada. Falta DAILY_API_KEY.',
    });
  }
  return { apiBase: dailyApiBase(), apiKey };
}

function dailyProviderError(status: number, statusText: string, errorBody: DailyErrorResponse): TRPCError {
  if (status === 401 || status === 403) {
    return new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Daily.co rechazo la clave configurada. Revisa DAILY_API_KEY.',
    });
  }

  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Daily.co API error (${status}): ${errorBody.error || errorBody.info || statusText}`,
  });
}

function twoHoursFromNow(): number {
  return Math.floor(Date.now() / 1000) + 2 * 60 * 60;
}

interface DailyRoomResponse {
  name: string;
  url: string;
  privacy: string;
  config: Record<string, unknown>;
}

interface DailyTokenResponse {
  token: string;
}

interface DailyErrorResponse {
  error?: string;
  info?: string;
}

async function dailyFetch<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { apiBase, apiKey } = assertConfigured();

  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as DailyErrorResponse;
    throw dailyProviderError(res.status, res.statusText, errorBody);
  }

  return res.json() as Promise<T>;
}

export const videoService = {
  isConfigured(): boolean {
    return dailyApiKey() !== null;
  },

  /**
   * Create or retrieve a private Daily.co room for an interview.
   * If room already exists, fetches it. Room expires 2 hours from creation.
   */
  async createRoom(interviewId: string): Promise<{ url: string; roomName: string }> {
    const roomName = `tims-${interviewId.slice(0, 8)}`;
    const { apiBase, apiKey } = assertConfigured();

    // Try to create the room
    const createRes = await fetch(`${apiBase}/rooms/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        name: roomName,
        privacy: 'private',
        properties: {
          exp: twoHoursFromNow(),
          enable_chat: true,
          enable_knocking: false,
        },
      }),
    });

    if (createRes.ok) {
      const data = (await createRes.json()) as DailyRoomResponse;
      return { url: data.url, roomName: data.name };
    }

    // Room already exists — fetch it instead
    if (createRes.status === 400) {
      const getRes = await fetch(`${apiBase}/rooms/${roomName}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (getRes.ok) {
        const data = (await getRes.json()) as DailyRoomResponse;
        return { url: data.url, roomName: data.name };
      }
    }

    const errorBody = (await createRes.json().catch(() => ({}))) as DailyErrorResponse;
    throw dailyProviderError(createRes.status, createRes.statusText, errorBody);
  },

  /**
   * Create a scoped meeting token for a user to join a room.
   * Token expires 2 hours from creation.
   */
  async createMeetingToken(
    roomName: string,
    userName: string,
    isOwner: boolean,
  ): Promise<string> {
    const data = await dailyFetch<DailyTokenResponse>('/meeting-tokens', {
      properties: {
        room_name: roomName,
        user_name: userName,
        is_owner: isOwner,
        exp: twoHoursFromNow(),
      },
    });

    return data.token;
  },
};
