import { describe, it, expect, beforeEach } from 'vitest';
import {
  readDraft,
  writeDraft,
  clearDraft,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/me/assessments/[assignmentId]/_lib/assessment-draft-storage';

describe('assessment-draft-storage', () => {
  beforeEach(() => {
    // happy-dom's localStorage may not have .clear(), so manually remove all keys
    if (typeof window.localStorage.clear === 'function') {
      window.localStorage.clear();
    } else {
      const keys = Object.keys(window.localStorage);
      keys.forEach((key) => window.localStorage.removeItem(key));
    }
  });

  it('returns null when nothing is stored for this assignment', () => {
    expect(readDraft('a1')).toBeNull();
  });

  it('round-trips a written draft', () => {
    writeDraft('a1', { q1: { selectedOptionIds: ['opt1'] } });
    const draft = readDraft('a1');
    expect(draft?.answers).toEqual({ q1: { selectedOptionIds: ['opt1'] } });
  });

  it('scopes drafts by assignmentId', () => {
    writeDraft('a1', { q1: { freeText: 'hello' } });
    expect(readDraft('a2')).toBeNull();
  });

  it('clears a draft', () => {
    writeDraft('a1', { q1: { freeText: 'hello' } });
    clearDraft('a1');
    expect(readDraft('a1')).toBeNull();
  });

  it('returns null for corrupted stored JSON instead of throwing', () => {
    window.localStorage.setItem('assessment-draft:a1', '{not json');
    expect(() => readDraft('a1')).not.toThrow();
    expect(readDraft('a1')).toBeNull();
  });
});
