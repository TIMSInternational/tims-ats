// tests/access/ai-interview-call-ui.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const exists = (p: string) => existsSync(resolve(root, p));
const DIR = 'apps/web/app/(portal)/ai-interview/[token]';

// Shared assertions applied to every new client component in this feature.
function assertCleanClientComponent(src: string) {
  expect(src).toMatch(/^'use client';/);
  expect(src).not.toContain('style={{');
  expect(src).not.toMatch(/:\s*any\b/);
  expect(src).not.toMatch(/as any\b/);
  expect(src).not.toContain('ELEVENLABS_API_KEY');
}

describe('participant-tile.tsx', () => {
  const FILE = `${DIR}/participant-tile.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('exports ParticipantTile with name/level/muted props', () => {
    const src = read(FILE);
    expect(src).toContain('export function ParticipantTile');
    expect(src).toContain('name');
    expect(src).toContain('level');
    expect(src).toContain('muted');
  });
});

describe('ai-orb.tsx', () => {
  const FILE = `${DIR}/ai-orb.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('exports AiOrb and accepts a state prop', () => {
    const src = read(FILE);
    expect(src).toContain('export function AiOrb');
    expect(src).toContain('state');
  });
  it('animates the speaking state via Tailwind (no inline style)', () => {
    const src = read(FILE);
    expect(src).toMatch(/animate-(pulse|ping)/);
  });
});

describe('transcript-panel.tsx', () => {
  const FILE = `${DIR}/transcript-panel.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('imports the transcript model and keys rows by entry id', () => {
    const src = read(FILE);
    expect(src).toContain('TranscriptState');
    expect(src).toContain('export function TranscriptPanel');
    expect(src).toContain('key={'); // keyed list
    expect(src).not.toMatch(/key=\{\s*i\s*\}/); // not array index
  });
});

describe('call-controls.tsx', () => {
  const FILE = `${DIR}/call-controls.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('exports CallControls with the three handlers', () => {
    const src = read(FILE);
    expect(src).toContain('export function CallControls');
    expect(src).toContain('onToggleMute');
    expect(src).toContain('onToggleView');
    expect(src).toContain('onEnd');
  });
});

describe('use-mic-level.ts', () => {
  const FILE = `${DIR}/use-mic-level.ts`;
  it('exists', () => {
    expect(exists(FILE)).toBe(true);
  });
  it('uses computeRmsLevel and cleans up the stream', () => {
    const src = read(FILE);
    expect(src).toContain('export function useMicLevel');
    expect(src).toContain('computeRmsLevel');
    expect(src).toContain('getUserMedia');
    expect(src).toContain('getTracks'); // teardown
    expect(src).not.toMatch(/:\s*any\b/);
  });
});

describe('use-interview-call.ts', () => {
  const FILE = `${DIR}/use-interview-call.ts`;
  it('exists', () => {
    expect(exists(FILE)).toBe(true);
  });
  it('wires useConversation + aiInterview.start and exposes the call API', () => {
    const src = read(FILE);
    expect(src).toContain('export function useInterviewCall');
    expect(src).toContain('useConversation');
    expect(src).toContain('aiInterview.start');
    expect(src).toContain('startSession');
    expect(src).toContain('endSession');
    expect(src).toContain('applyTranscriptEvent');
    expect(src).not.toContain('ELEVENLABS_API_KEY');
    expect(src).not.toMatch(/:\s*any\b/);
  });
});

describe('lobby.tsx', () => {
  const FILE = `${DIR}/lobby.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('exports Lobby, uses the mic-level preview, and a join handler', () => {
    const src = read(FILE);
    expect(src).toContain('export function Lobby');
    expect(src).toContain('useMicLevel');
    expect(src).toContain('onJoin');
    expect(src).toContain('lobbyJoin');
  });
});

describe('call-shell.tsx', () => {
  const FILE = `${DIR}/call-shell.tsx`;
  it('exists and is a clean client component', () => {
    expect(exists(FILE)).toBe(true);
    assertCleanClientComponent(read(FILE));
  });
  it('composes orb + tile + transcript + controls and toggles views', () => {
    const src = read(FILE);
    expect(src).toContain('export function CallShell');
    expect(src).toContain('AiOrb');
    expect(src).toContain('ParticipantTile');
    expect(src).toContain('TranscriptPanel');
    expect(src).toContain('CallControls');
    expect(src).toMatch(/'call'|"call"/);
    expect(src).toMatch(/'focus'|"focus"/);
  });
});

describe('voice-room.tsx — screen state machine', () => {
  const FILE = `${DIR}/voice-room.tsx`;
  it('still wraps in ConversationProvider and renders the new screens', () => {
    const src = read(FILE);
    expect(src).toContain('ConversationProvider');
    expect(src).toContain('useInterviewCall');
    expect(src).toContain('Lobby');
    expect(src).toContain('CallShell');
    expect(src).toContain('completed'); // completed screen via i18n key
    expect(src).not.toContain('style={{');
    expect(src).not.toMatch(/:\s*any\b/);
  });
});
