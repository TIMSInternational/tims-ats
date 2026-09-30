import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  candidateJoinApplies,
  candidateJoinUrl,
  clearedJoinTokenColumns,
  generateJoinToken,
  hashJoinToken,
  issueJoinToken,
  joinTokenExpiry,
} from '../../packages/api/src/services/interview-join-token';
import {
  dailyRoomName,
  legacyRoomNameFor,
  ownDailyRoomName,
  roomNameFor,
} from '../../packages/api/src/services/video.service';

const ID = '1234abcd-0000-4000-8000-000000000001';

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

  it('mints a token only when the candidate will join through our own Daily room', () => {
    const start = new Date('2026-10-01T15:00:00Z');
    expect(issueJoinToken('video', start, 60, { meetingUrl: 'https://zoom.us/j/1' }).token).toBeNull();
    expect(issueJoinToken('video', start, 60, { meetingUrl: null }).token).not.toBeNull();
    expect(candidateJoinApplies('video', { meetingUrl: `https://tims.daily.co/${roomNameFor(ID)}`, interviewId: ID })).toBe(true);
    expect(candidateJoinApplies('video', { meetingUrl: `https://tims.daily.co/${legacyRoomNameFor(ID)}`, interviewId: ID })).toBe(true);
    // A Daily room that is not this interview's own (or whose owner cannot be checked) is an external link.
    expect(candidateJoinApplies('video', { meetingUrl: 'https://tims.daily.co/someone-else', interviewId: ID })).toBe(false);
    expect(candidateJoinApplies('video', { meetingUrl: `https://tims.daily.co/${roomNameFor(ID)}` })).toBe(false);
    expect(candidateJoinApplies('phone', { meetingUrl: null })).toBe(false);
  });

  it('names new rooms from the FULL id, identical to C# CandidateInterviewJoin.RoomNameFor', () => {
    // Same fixture as services/Tims.Platform/tests/Tims.UnitTests/InterviewJoin/CandidateInterviewJoinTests.cs.
    expect(roomNameFor(ID)).toBe('tims-1234abcd000040008000000000000001');
    expect(legacyRoomNameFor(ID)).toBe('tims-1234abcd');
  });

  it.each([
    [`https://tims.daily.co/tims-1234abcd000040008000000000000001`, 'tims-1234abcd000040008000000000000001'],
    ['https://tims.daily.co/tims-1234abcd', 'tims-1234abcd'],
    ['https://tims.daily.co/tims-1234abcd000040008000000000000002', null], // another interview
    ['https://tims.daily.co/tims-99999999', null],
    ['https://zoom.us/j/tims-1234abcd', null],
    ['https://tims.daily.co.evil.test/tims-1234abcd', null],
    ['http://tims.daily.co/tims-1234abcd', null],
    ['https://tims.daily.co/tims-1234abcd?x=1', null],
  ])('ownDailyRoomName(%s) → %s', (url, expected) => {
    expect(ownDailyRoomName(url, ID)).toBe(expected);
  });

  it('parses only plain https *.daily.co room URLs', () => {
    expect(dailyRoomName('https://tims.daily.co/room_1')).toBe('room_1');
    expect(dailyRoomName('https://daily.co/room')).toBeNull();
    expect(dailyRoomName('https://u:p@tims.daily.co/room')).toBeNull();
    expect(dailyRoomName('https://tims.daily.co/a/b')).toBeNull();
    expect(dailyRoomName(null)).toBeNull();
  });

  it('builds the public join URL', () => {
    expect(candidateJoinUrl('https://app.example/', 'tok')).toBe('https://app.example/interview/join/tok');
  });
});
