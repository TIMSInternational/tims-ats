import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  candidateJoinUrl,
  clearedJoinTokenColumns,
  generateJoinToken,
  hashJoinToken,
  issueJoinToken,
  joinTokenExpiry,
} from '../../packages/api/src/services/interview-join-token';

describe('interview join token', () => {
  it('generates a 43-char base64url token (32 random bytes)', () => {
    const token = generateJoinToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateJoinToken()).not.toBe(token);
  });

  it('hashes as lowercase hex SHA-256 of the UTF-8 token', () => {
    const token = 'abc_DEF-123';
    expect(hashJoinToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashJoinToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('expires 30 minutes after the scheduled end', () => {
    const start = new Date('2026-10-01T15:00:00Z');
    expect(joinTokenExpiry(start, 45).toISOString()).toBe('2026-10-01T16:15:00.000Z');
  });

  it('issues a fresh token + matching hash for video, nothing for other types', () => {
    const start = new Date('2026-10-01T15:00:00Z');
    const a = issueJoinToken('video', start, 60);
    const b = issueJoinToken('video', start, 60);
    expect(a.token).not.toBeNull();
    expect(a.columns.candidateJoinTokenHash).toBe(hashJoinToken(a.token as string));
    expect(a.columns.candidateJoinTokenExpiresAt?.toISOString()).toBe('2026-10-01T16:30:00.000Z');
    expect(b.token).not.toBe(a.token);
    for (const type of ['phone', 'onsite', 'technical']) {
      expect(issueJoinToken(type, start, 60)).toEqual({ token: null, columns: clearedJoinTokenColumns() });
    }
  });

  it('builds the public join URL', () => {
    expect(candidateJoinUrl('https://app.example/', 'tok')).toBe('https://app.example/interview/join/tok');
  });
});
