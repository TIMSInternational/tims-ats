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

const ROOM_NAME = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Room name for a NEW interview room: 'tims-' + the FULL interview id without dashes. Must stay identical to
 * the C# CandidateInterviewJoin.RoomNameFor, so staff (here) and the candidate (C# join) land in the same
 * room. The old 8-hex prefix (32 bits) could collide across interviews and tenants, and the "already
 * exists" 400 below would then hand one interview another's room.
 */
export function roomNameFor(interviewId: string): string {
  return `tims-${interviewId.replace(/-/g, '').toLowerCase()}`;
}

/** Pre-2026-09 naming ('tims-' + first 8 chars). Honoured only when it is the row's own stored meeting URL. */
export function legacyRoomNameFor(interviewId: string): string {
  return `tims-${interviewId.slice(0, 8).toLowerCase()}`;
}

/**
 * The Daily room name of an https `*.daily.co/<room>` URL (no credentials, port, query or fragment), else null.
 * Mirrors C# CandidateInterviewJoin.TryDailyRoom.
 */
export function dailyRoomName(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    !host.endsWith('.daily.co') ||
    host.length <= '.daily.co'.length
  ) {
    return null;
  }
  const name = parsed.pathname.replace(/^\/+/, '');
  return ROOM_NAME.test(name) ? name : null;
}

/**
 * The room name of `meetingUrl` when it is THIS interview's own Daily room (full-id or legacy name), else null.
 * A stored URL naming any other room is never used to mint a Daily token: that room is not bound to this
 * interview, so a token for it could admit someone to another interview's (or tenant's) call.
 */
export function ownDailyRoomName(meetingUrl: string | null | undefined, interviewId: string): string | null {
  const name = dailyRoomName(meetingUrl);
  return name && (name === roomNameFor(interviewId) || name === legacyRoomNameFor(interviewId)) ? name : null;
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
    const roomName = roomNameFor(interviewId);
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

    // Room already exists — fetch it instead. Safe only because the name is derived from the whole
    // interview id: no other interview can have created a room with this name.
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
