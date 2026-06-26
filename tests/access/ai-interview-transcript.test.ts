// tests/access/ai-interview-transcript.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyTranscriptEvent,
  emptyTranscript,
} from '../../apps/web/app/(portal)/ai-interview/[token]/transcript';

describe('applyTranscriptEvent', () => {
  it('appends a finalized AI turn', () => {
    const s = applyTranscriptEvent(emptyTranscript, { source: 'ai', text: 'Hola', final: true });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ role: 'ai', text: 'Hola', final: true });
  });

  it('streams a non-final AI turn by updating the same entry', () => {
    let s = applyTranscriptEvent(emptyTranscript, { source: 'ai', text: 'Cuén', final: false });
    s = applyTranscriptEvent(s, { source: 'ai', text: 'Cuéntame', final: false });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0].text).toBe('Cuéntame');
    expect(s.entries[0].final).toBe(false);
  });

  it('finalizes the streaming entry, then a new turn starts a new entry', () => {
    let s = applyTranscriptEvent(emptyTranscript, { source: 'ai', text: 'Hola', final: false });
    s = applyTranscriptEvent(s, { source: 'ai', text: 'Hola.', final: true });
    s = applyTranscriptEvent(s, { source: 'user', text: 'Listo', final: true });
    expect(s.entries).toHaveLength(2);
    expect(s.entries[0]).toMatchObject({ role: 'ai', final: true });
    expect(s.entries[1]).toMatchObject({ role: 'user', text: 'Listo' });
  });

  it('a different role mid-stream starts a new entry', () => {
    let s = applyTranscriptEvent(emptyTranscript, { source: 'ai', text: 'A', final: false });
    s = applyTranscriptEvent(s, { source: 'user', text: 'B', final: false });
    expect(s.entries).toHaveLength(2);
  });

  it('gives every entry a unique id and does not mutate input', () => {
    const s1 = applyTranscriptEvent(emptyTranscript, { source: 'ai', text: 'X', final: true });
    const s2 = applyTranscriptEvent(s1, { source: 'user', text: 'Y', final: true });
    expect(emptyTranscript.entries).toHaveLength(0); // input untouched
    expect(new Set(s2.entries.map((e) => e.id)).size).toBe(2);
  });
});
