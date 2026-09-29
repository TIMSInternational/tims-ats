// ---------------------------------------------------------------------------
// Candidate video-interview join token (pure helpers)
// ---------------------------------------------------------------------------
// The candidate joins a video interview through a PUBLIC link
// `${appUrl}/interview/join/<token>` (validated by the C# join endpoint). Only the
// SHA-256 hex of the token is persisted (`interviews.candidate_join_token_hash`);
// the plaintext exists only in memory long enough to be put into the candidate's
// invitation email. NEVER log the token or the join URL.

import { createHash, randomBytes } from 'node:crypto';

/** Interview types that get a candidate join link. */
export const JOIN_LINK_INTERVIEW_TYPES: ReadonlySet<string> = new Set(['video']);

/** The link stays valid until 30 minutes after the scheduled end. */
export const JOIN_TOKEN_GRACE_MINUTES = 30;

export function interviewHasJoinLink(type: string): boolean {
  return JOIN_LINK_INTERVIEW_TYPES.has(type);
}

/** 32 random bytes → 43-char base64url (no padding). */
export function generateJoinToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Lowercase hex SHA-256 of the UTF-8 token — the persisted form. */
export function hashJoinToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** scheduledAt + duration + 30 min. */
export function joinTokenExpiry(scheduledAt: Date, durationMinutes: number): Date {
  return new Date(scheduledAt.getTime() + (durationMinutes + JOIN_TOKEN_GRACE_MINUTES) * 60_000);
}

export type JoinTokenColumns = {
  candidateJoinTokenHash: string | null;
  candidateJoinTokenExpiresAt: Date | null;
};

/**
 * Computes the join-token columns for a create/reschedule write. A fresh token is
 * minted on EVERY call for a video interview, so a reschedule revokes the old link.
 * Non-video interviews get both columns cleared. `token` is the plaintext for the
 * email (null when there is no link).
 */
export function issueJoinToken(
  type: string,
  scheduledAt: Date,
  durationMinutes: number,
): { token: string | null; columns: JoinTokenColumns } {
  if (!interviewHasJoinLink(type)) {
    return { token: null, columns: clearedJoinTokenColumns() };
  }
  const token = generateJoinToken();
  return {
    token,
    columns: {
      candidateJoinTokenHash: hashJoinToken(token),
      candidateJoinTokenExpiresAt: joinTokenExpiry(scheduledAt, durationMinutes),
    },
  };
}

/** Cancel (or type change away from video) revokes the link. */
export function clearedJoinTokenColumns(): JoinTokenColumns {
  return { candidateJoinTokenHash: null, candidateJoinTokenExpiresAt: null };
}

export function candidateJoinUrl(appUrl: string, token: string): string {
  return `${appUrl.replace(/\/+$/, '')}/interview/join/${encodeURIComponent(token)}`;
}

export function staffRoomUrl(appUrl: string, interviewId: string): string {
  return `${appUrl.replace(/\/+$/, '')}/recruitment/interviews/${encodeURIComponent(interviewId)}/room`;
}
