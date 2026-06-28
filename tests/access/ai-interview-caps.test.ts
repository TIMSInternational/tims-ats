// tests/access/ai-interview-caps.test.ts
import { describe, it, expect } from 'vitest';
import {
  isEnabledConfig,
  resolveMaxDurationSeconds,
  AI_VOICE_INTERVIEW_SLUG,
  AI_INTERVIEW_DEFAULT_MAX_MINUTES,
  type AiInterviewConfig,
} from '../../packages/api/src/services/ai-interview-access.service';

const base: AiInterviewConfig = {
  enabled: true,
  monthlyBudget: null,
  billableUsdPerMinute: null,
  addonMonthlyFeeUsd: null,
  aiInterviewDefaultMaxMinutes: null,
  aiInterviewMaxMinutesByType: null,
};

describe('AI_VOICE_INTERVIEW_SLUG', () => {
  it('is the canonical agent slug', () => {
    expect(AI_VOICE_INTERVIEW_SLUG).toBe('ai-voice-interview');
    expect(AI_INTERVIEW_DEFAULT_MAX_MINUTES).toBe(15);
  });
});

describe('isEnabledConfig', () => {
  it('false when no row', () => {
    expect(isEnabledConfig(null)).toBe(false);
  });
  it('false when disabled', () => {
    expect(isEnabledConfig({ ...base, enabled: false })).toBe(false);
  });
  it('true when enabled row present', () => {
    expect(isEnabledConfig({ ...base, enabled: true })).toBe(true);
  });
});

describe('resolveMaxDurationSeconds', () => {
  it('falls back to 15 min when nothing configured', () => {
    expect(resolveMaxDurationSeconds('technical', null)).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', base)).toBe(15 * 60);
  });
  it('uses org default when set and no override matches', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewDefaultMaxMinutes: 20 })).toBe(20 * 60);
  });
  it('prefers a per-type override over the default', () => {
    const config = { ...base, aiInterviewDefaultMaxMinutes: 20, aiInterviewMaxMinutesByType: { technical: 30 } };
    expect(resolveMaxDurationSeconds('technical', config)).toBe(30 * 60);
    expect(resolveMaxDurationSeconds('cultural', config)).toBe(20 * 60); // unmatched type → default
  });
  it('ignores a malformed override map (non-numeric / non-object) and uses default/fallback', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: 'garbage' })).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: { technical: 'nope' } })).toBe(15 * 60);
  });
  it('ignores non-positive override/default values', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: { technical: 0 } })).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewDefaultMaxMinutes: -5 })).toBe(15 * 60);
  });
});
