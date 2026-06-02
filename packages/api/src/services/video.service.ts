// ---------------------------------------------------------------------------
// Video Service — Daily.co integration for interview video rooms
// Creates private rooms and scoped meeting tokens via Daily REST API
// ---------------------------------------------------------------------------

import { TRPCError } from '@trpc/server';

const DAILY_API_BASE = 'https://api.daily.co/v1';

function getApiKey(): string {
  const key = process.env.DAILY_API_KEY;
  if (!key) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'DAILY_API_KEY is not configured',
    });
  }
  return key;
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
  const apiKey = getApiKey();

  const res = await fetch(`${DAILY_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as DailyErrorResponse;
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Daily.co API error (${res.status}): ${errorBody.error || errorBody.info || res.statusText}`,
    });
  }

  return res.json() as Promise<T>;
}

export const videoService = {
  /**
   * Create or retrieve a private Daily.co room for an interview.
   * If room already exists, fetches it. Room expires 2 hours from creation.
   */
  async createRoom(interviewId: string): Promise<{ url: string; roomName: string }> {
    const roomName = `tims-${interviewId.slice(0, 8)}`;
    const apiKey = getApiKey();

    // Try to create the room
    const createRes = await fetch(`${DAILY_API_BASE}/rooms/`, {
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
      const getRes = await fetch(`${DAILY_API_BASE}/rooms/${roomName}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (getRes.ok) {
        const data = (await getRes.json()) as DailyRoomResponse;
        return { url: data.url, roomName: data.name };
      }
    }

    const errorBody = (await createRes.json().catch(() => ({}))) as DailyErrorResponse;
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Daily.co API error (${createRes.status}): ${errorBody.error || errorBody.info || createRes.statusText}`,
    });
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
