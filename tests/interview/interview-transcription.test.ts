import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  INTERVIEW_TRANSCRIPTION_CONSENT_VERSION,
  isInAppVideoEnabled,
  isInterviewTranscriptionUiEnabled,
  transcriptAnalysisSchema,
  transcriptionStatusSchema,
  transcriptViewSchema,
} from '../../apps/web/lib/interview-transcription';
import { interviewJoinResultSchema, parseInterviewJoinRequest } from '../../apps/web/lib/interview-join';
import {
  externalMeetingLink,
  isVideoInterview,
} from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-mode';
import { applySuggestion } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-suggestion';
import { OVERALL_NOTES_MAX } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-model';
import { buildCsp, isDailyCallRoute } from '../../apps/web/lib/security/csp';

const ROOT = resolve(__dirname, '../..');
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

describe('transcription switches are OFF unless exactly "true"', () => {
  it('needs both the transcription flag and in-app video', () => {
    expect(isInterviewTranscriptionUiEnabled(undefined, true)).toBe(false);
    expect(isInterviewTranscriptionUiEnabled('1', true)).toBe(false);
    expect(isInterviewTranscriptionUiEnabled('true', false)).toBe(false);
    expect(isInterviewTranscriptionUiEnabled('true', true)).toBe(true);
    expect(isInAppVideoEnabled(undefined)).toBe(false);
    expect(isInAppVideoEnabled('TRUE')).toBe(false);
    expect(isInAppVideoEnabled('true')).toBe(true);
  });

  it('the notice version is the one the C# platform records (cross-runtime pin)', () => {
    const cs = readFileSync(
      resolve(
        ROOT,
        'services/Tims.Platform/src/Tims.Application/InterviewTranscription/InterviewTranscriptionContracts.cs',
      ),
      'utf8',
    );
    expect(cs).toContain(`ConsentTextVersion = "${INTERVIEW_TRANSCRIPTION_CONSENT_VERSION}"`);
  });
});

describe('candidate join contract', () => {
  it('accepts exactly { token } or { token, recordingConsent, consentVersion }', () => {
    expect(parseInterviewJoinRequest({ token: TOKEN })).toEqual({ token: TOKEN });
    const decided = {
      token: TOKEN,
      recordingConsent: 'declined',
      consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION,
    };
    expect(parseInterviewJoinRequest(decided)).toEqual(decided);
    for (const bad of [
      null,
      [],
      { token: 'short' },
      { token: TOKEN, extra: 1 },
      { token: TOKEN, recordingConsent: 'maybe', consentVersion: 'v' },
      { token: TOKEN, recordingConsent: 'accepted' },
      { token: TOKEN, recordingConsent: 'accepted', consentVersion: '' },
      { token: TOKEN, recordingConsent: 'accepted', consentVersion: 'x'.repeat(65) },
      { token: TOKEN, recordingConsent: 'accepted', consentVersion: 'v', organizationId: 'x' },
    ]) {
      expect(parseInterviewJoinRequest(bad)).toBeNull();
    }
  });

  it('parses consent_required with its version and still rejects unknown fields', () => {
    const asked = interviewJoinResultSchema.parse({
      outcome: 'consent_required',
      consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION,
    });
    expect(asked.outcome).toBe('consent_required');
    // The flag-off C# answer has no consentVersion key at all: still valid.
    expect(interviewJoinResultSchema.safeParse({ outcome: 'ready', joinUrl: 'https://t.daily.co/r?t=x' }).success).toBe(
      true,
    );
    expect(interviewJoinResultSchema.safeParse({ outcome: 'ready', organizationId: 'x' }).success).toBe(false);
  });
});

describe('platform answers are re-validated strictly', () => {
  it('status and transcript views reject extra or name-shaped fields', () => {
    const status = {
      consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION,
      candidateDecision: 'accepted',
      candidateDecidedAt: '2026-11-06T15:00:00.000Z',
      viewerAcknowledged: true,
      transcriptState: 'ready',
      transcriptAvailable: true,
      canStart: false,
    };
    expect(transcriptionStatusSchema.safeParse(status).success).toBe(true);
    expect(transcriptionStatusSchema.safeParse({ ...status, candidateName: 'Ana' }).success).toBe(false);
    const view = {
      organizationId: '11111111-1111-4111-8111-111111111111',
      interviewId: '22222222-2222-4222-8222-222222222222',
      vacancyTitle: null,
      language: 'es',
      competencies: [{ name: 'SQL', level: null }],
      segments: [{ startSeconds: 3, speaker: 'candidate', text: 'Hola' }],
      truncated: false,
    };
    expect(transcriptViewSchema.safeParse(view).success).toBe(true);
    // A speaker label that is not a role (e.g. a leaked name) is refused.
    const named = { ...view, segments: [{ startSeconds: 3, speaker: 'Ana Pérez', text: 'Hola' }] };
    expect(transcriptViewSchema.safeParse(named).success).toBe(false);
    const empty = { summary: '', questions: [], competencies: [], limitations: [], degraded: false, truncated: false };
    expect(transcriptAnalysisSchema.safeParse(empty).success).toBe(true);
  });
});

describe('a pasted meeting link stays an option', () => {
  it('a video interview with a Teams/Meet link is held there, not in a platform call', () => {
    const teams = 'https://teams.microsoft.com/l/meetup-join/abc';
    expect(isVideoInterview({ type: 'video', meetingUrl: teams })).toBe(false);
    expect(externalMeetingLink({ meetingUrl: teams })).toBe(teams);
    expect(isVideoInterview({ type: 'video', meetingUrl: null })).toBe(true);
    expect(isVideoInterview({ type: 'video', meetingUrl: 'https://tims.daily.co/tims-abc' })).toBe(true);
    expect(externalMeetingLink({ meetingUrl: 'https://tims.daily.co/tims-abc' })).toBeNull();
    expect(externalMeetingLink({ meetingUrl: 'http://insecure.example/x' })).toBeNull();
    expect(externalMeetingLink({ meetingUrl: 'javascript:alert(1)' })).toBeNull();
  });
});

describe('copying an AI suggestion into the scorecard draft', () => {
  const empty = { ratings: {}, recommendation: null, overallNotes: '' };
  const keys = ['communication', 'SQL'];

  it('fills an empty rating and appends the evidence, never touching the recommendation', () => {
    const r = applySuggestion(empty, { key: 'SQL', rating: 4, noteLines: ['[IA · SQL] «uso SQL» (01:18)'] }, keys);
    expect(r.draft.ratings).toEqual({ SQL: 4 });
    expect(r.draft.overallNotes).toBe('[IA · SQL] «uso SQL» (01:18)');
    expect(r.draft.recommendation).toBeNull();
    expect(r.ratingApplied).toBe(true);
  });

  it("keeps the evaluator's own rating and ignores competencies not on the card", () => {
    const kept = applySuggestion({ ...empty, ratings: { SQL: 2 } }, { key: 'SQL', rating: 5, noteLines: [] }, keys);
    expect(kept.draft.ratings).toEqual({ SQL: 2 });
    expect(kept.ratingKept).toBe(true);
    expect(applySuggestion(empty, { key: 'leadership', rating: 5, noteLines: [] }, keys).draft.ratings).toEqual({});
    expect(applySuggestion(empty, { key: 'SQL', rating: 7, noteLines: [] }, keys).draft.ratings).toEqual({});
    expect(applySuggestion(empty, { key: 'SQL', rating: null, noteLines: [] }, keys).ratingApplied).toBe(false);
  });

  it('de-duplicates evidence lines and stays within the notes bound', () => {
    const line = 'evidencia';
    const twice = applySuggestion(
      { ...empty, overallNotes: line },
      { key: 'SQL', rating: null, noteLines: [line] },
      keys,
    );
    expect(twice.draft.overallNotes).toBe(line);
    const full = { ...empty, overallNotes: 'x'.repeat(OVERALL_NOTES_MAX - 3) };
    const r = applySuggestion(full, { key: 'SQL', rating: null, noteLines: ['too long to fit'] }, keys);
    expect(r.draft.overallNotes.length).toBeLessThanOrEqual(OVERALL_NOTES_MAX);
    expect(r.notesTruncated).toBe(true);
  });
});

describe('CSP for the candidate in-app call', () => {
  it('relaxes the join page only while in-app video is on', () => {
    expect(isDailyCallRoute('/interview/join/tok_abc')).toBe(false);
    expect(isDailyCallRoute('/interview/join/tok_abc', { candidateInAppVideo: true })).toBe(true);
    expect(isDailyCallRoute('/interview/join/a/b', { candidateInAppVideo: true })).toBe(false);
    const origins = { platformApi: '', cvUpload: '' };
    expect(buildCsp('n', '/interview/join/tok', origins, true)).not.toContain('https://*.dailywebrtc.com');
    expect(buildCsp('n', '/interview/join/tok', origins, true, { candidateInAppVideo: true })).toContain(
      'https://*.dailywebrtc.com',
    );
  });
});
