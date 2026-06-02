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
   * Create a private Daily.co room for an interview.
   * Room expires 2 hours from creation.
   */
  async createRoom(interviewId: string): Promise<{ url: string; roomName: string }> {
    const roomName = `tims-${interviewId.slice(0, 8)}`;

    const data = await dailyFetch<DailyRoomResponse>('/rooms/', {
      name: roomName,
      privacy: 'private',
      properties: {
        exp: twoHoursFromNow(),
        enable_chat: true,
        enable_knocking: false,
      },
    });

    return { url: data.url, roomName: data.name };
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
