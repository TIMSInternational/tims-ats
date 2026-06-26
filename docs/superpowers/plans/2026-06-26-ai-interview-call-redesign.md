# AI Voice Interview — Conversational Call Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the candidate AI-interview page into a full-screen, Zoom-style 1:1 conversational call (consent → lobby → call with switchable Call/Focus views, audio-only avatars, AI voice orb, live transcript), refactoring the monolithic `voice-room.tsx` into focused components.

**Architecture:** Pure logic (transcript model, audio level) is extracted and behaviorally unit-tested. The ElevenLabs + tRPC wiring is isolated in a `useInterviewCall` hook. Presentational components (`AiOrb`, `ParticipantTile`, `TranscriptPanel`, `CallControls`), the `Lobby`, and the `CallShell` are pure-ish view units verified with the repo's static-source tripwire convention. `voice-room.tsx` becomes a slim screen state machine (lobby → call → completed) inside `ConversationProvider`. No backend changes.

**Tech Stack:** Next.js 15 App Router (client components), `@elevenlabs/react@1.7.1`, tRPC, Tailwind 4, TypeScript strict, Vitest (node environment — no RTL/jsdom).

## Global Constraints

- TypeScript strict; **no `any`** (no `: any`, no `as any`). Use `unknown` + narrow.
- **No inline styles** (`style={{ }}` is banned by tripwire tests). Use Tailwind classes only; animations via Tailwind utilities (`animate-pulse`, `animate-ping`).
- **No hardcoded user-facing strings.** All copy via `useI18n()` from `lib/i18n`; keys live under `aiInterview.*` in BOTH `apps/web/lib/i18n/es.json` and `en.json`, with identical key sets.
- **`ELEVENLABS_API_KEY` (and any secret) must never appear in client code.** The signed URL comes only from `aiInterview.start`.
- Max 300 lines per component file; one component per file; kebab-case filenames; PascalCase components.
- All new files are client components: first line `'use client';` (except pure `.ts` logic modules, which have no directive).
- Backend untouched: do NOT modify `aiInterview.start`, the webhook, analysis, schema, or env.
- Run from repo root: tests `npx vitest run`; api types `pnpm --filter @tims/api exec tsc --noEmit`; web types `cd apps/web && npx tsc --noEmit`; build `cd apps/web && npx next build`.

**Working directory for all UI files:** `apps/web/app/(portal)/ai-interview/[token]/`

---

## File Structure

Under `apps/web/app/(portal)/ai-interview/[token]/`:

- `transcript.ts` (new, pure) — transcript types + `applyTranscriptEvent` reducer. Behavioral tests.
- `audio-level.ts` (new, pure) — `computeRmsLevel`. Behavioral tests.
- `use-mic-level.ts` (new, hook) — mic input level 0..1 from a live stream (lobby preview).
- `use-interview-call.ts` (new, hook) — owns `useConversation` + `aiInterview.start`; exposes the call API.
- `ai-orb.tsx` (new) — AI voice orb, `state` prop.
- `participant-tile.tsx` (new) — audio-only avatar + level meter.
- `transcript-panel.tsx` (new) — renders transcript (panel + focus variants).
- `call-controls.tsx` (new) — mute / view-toggle / end buttons.
- `lobby.tsx` (new) — mic check + device picker + join button.
- `call-shell.tsx` (new) — full-screen layout, top bar, view modes, control bar.
- `voice-room.tsx` (rewrite) — `ConversationProvider` + screen state machine.
- `page.tsx` (unchanged) — consent gate → `VoiceRoom`.

Tests:
- `tests/access/ai-interview-transcript.test.ts` (new, behavioral)
- `tests/access/ai-interview-audio-level.test.ts` (new, behavioral)
- `tests/access/ai-interview-call-ui.test.ts` (new, tripwires for the new components)
- `tests/access/ai-interview-ui.test.ts` (modify — move SDK-wiring tripwires from `voice-room.tsx` to `use-interview-call.ts`, add new i18n keys)

i18n:
- `apps/web/lib/i18n/es.json`, `apps/web/lib/i18n/en.json` (modify — add `aiInterview.*` keys).

---

## Task 1: i18n keys for lobby + call UI

**Files:**
- Modify: `apps/web/lib/i18n/es.json` (`aiInterview` object)
- Modify: `apps/web/lib/i18n/en.json` (`aiInterview` object)
- Modify: `tests/access/ai-interview-ui.test.ts` (extend `AI_I18N_KEYS`)

**Interfaces:**
- Produces: i18n keys consumed by all later component tasks: `lobbyHeading`, `lobbyMicCheck`, `lobbyMicWorking`, `lobbyMicDevice`, `lobbyJoin`, `lobbyMicDenied`, `liveTranscript`, `callView`, `focusView`, `aiSpeaking`, `aiListening`, `you`, `muteMic`, `unmuteMic`, `reconnecting`, `interviewer`.

- [ ] **Step 1: Add the new keys to the tripwire list (failing test first)**

In `tests/access/ai-interview-ui.test.ts`, extend the `AI_I18N_KEYS` array (keep existing entries) by adding:

```ts
  'lobbyHeading',
  'lobbyMicCheck',
  'lobbyMicWorking',
  'lobbyMicDevice',
  'lobbyJoin',
  'lobbyMicDenied',
  'liveTranscript',
  'callView',
  'focusView',
  'aiSpeaking',
  'aiListening',
  'you',
  'muteMic',
  'unmuteMic',
  'reconnecting',
  'interviewer',
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-ui.test.ts`
Expected: FAIL — `es aiInterview.lobbyHeading` / `en aiInterview.lobbyHeading` truthy assertions fail (keys missing).

- [ ] **Step 3: Add the keys to both locales**

In `apps/web/lib/i18n/en.json`, inside the `"aiInterview"` object, add:

```json
    "lobbyHeading": "Ready to start your interview",
    "lobbyMicCheck": "Microphone check",
    "lobbyMicWorking": "We can hear you",
    "lobbyMicDevice": "Microphone",
    "lobbyJoin": "Join the interview",
    "lobbyMicDenied": "We need microphone access to run the interview. Enable it in your browser and try again.",
    "liveTranscript": "Live transcript",
    "callView": "Call view",
    "focusView": "Focus view",
    "aiSpeaking": "Speaking",
    "aiListening": "Listening",
    "you": "You",
    "muteMic": "Mute microphone",
    "unmuteMic": "Unmute microphone",
    "reconnecting": "Reconnecting…",
    "interviewer": "AI interviewer"
```

In `apps/web/lib/i18n/es.json`, inside the `"aiInterview"` object, add:

```json
    "lobbyHeading": "Listo para comenzar tu entrevista",
    "lobbyMicCheck": "Prueba de micrófono",
    "lobbyMicWorking": "Te escuchamos",
    "lobbyMicDevice": "Micrófono",
    "lobbyJoin": "Unirse a la entrevista",
    "lobbyMicDenied": "Necesitamos acceso al micrófono para la entrevista. Actívalo en tu navegador e inténtalo de nuevo.",
    "liveTranscript": "Transcripción en vivo",
    "callView": "Vista de llamada",
    "focusView": "Vista de enfoque",
    "aiSpeaking": "Hablando",
    "aiListening": "Escuchando",
    "you": "Tú",
    "muteMic": "Silenciar micrófono",
    "unmuteMic": "Activar micrófono",
    "reconnecting": "Reconectando…",
    "interviewer": "Entrevistador IA"
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-ui.test.ts`
Expected: PASS (keys present in both locales; identical key sets).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/access/ai-interview-ui.test.ts
git commit -m "feat(ai-interview): i18n keys for lobby + call UI"
```

---

## Task 2: Transcript model + reducer (pure)

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/transcript.ts`
- Test: `tests/access/ai-interview-transcript.test.ts`

**Interfaces:**
- Produces:
  - `interface TranscriptEntry { id: string; role: 'ai' | 'user'; text: string; final: boolean }`
  - `interface TranscriptState { entries: TranscriptEntry[] }`
  - `interface TranscriptEvent { source: 'ai' | 'user'; text: string; final: boolean }`
  - `const emptyTranscript: TranscriptState`
  - `function applyTranscriptEvent(state: TranscriptState, event: TranscriptEvent): TranscriptState`
- Behavior: a non-final event for the same role as the trailing non-final entry **updates** that entry's text (streaming). Any event whose role differs from the trailing entry, or that follows a finalized entry, **starts a new entry**. `final` flips the trailing entry to finalized.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-transcript.test.ts`
Expected: FAIL — cannot resolve module `transcript`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/(portal)/ai-interview/[token]/transcript.ts
export interface TranscriptEntry {
  id: string;
  role: 'ai' | 'user';
  text: string;
  final: boolean;
}

export interface TranscriptState {
  entries: TranscriptEntry[];
}

export interface TranscriptEvent {
  source: 'ai' | 'user';
  text: string;
  final: boolean;
}

export const emptyTranscript: TranscriptState = { entries: [] };

export function applyTranscriptEvent(
  state: TranscriptState,
  event: TranscriptEvent,
): TranscriptState {
  const last = state.entries[state.entries.length - 1];
  const canExtend = last && !last.final && last.role === event.source;

  if (canExtend) {
    const updated: TranscriptEntry = { ...last, text: event.text, final: event.final };
    return { entries: [...state.entries.slice(0, -1), updated] };
  }

  const entry: TranscriptEntry = {
    id: `${state.entries.length}-${event.source}`,
    role: event.source,
    text: event.text,
    final: event.final,
  };
  return { entries: [...state.entries, entry] };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-transcript.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/transcript.ts" tests/access/ai-interview-transcript.test.ts
git commit -m "feat(ai-interview): pure transcript model + streaming reducer"
```

---

## Task 3: Audio level helper (pure)

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/audio-level.ts`
- Test: `tests/access/ai-interview-audio-level.test.ts`

**Interfaces:**
- Produces: `function computeRmsLevel(timeDomain: Uint8Array): number` — RMS over 8-bit time-domain samples (centered at 128), returns a normalized 0..1 level.

- [ ] **Step 1: Write the failing test**

```ts
// tests/access/ai-interview-audio-level.test.ts
import { describe, it, expect } from 'vitest';
import { computeRmsLevel } from '../../apps/web/app/(portal)/ai-interview/[token]/audio-level';

describe('computeRmsLevel', () => {
  it('returns 0 for silence (all samples at 128)', () => {
    expect(computeRmsLevel(new Uint8Array(64).fill(128))).toBe(0);
  });

  it('returns ~1 for full-scale alternating extremes', () => {
    const buf = new Uint8Array(64);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 2 === 0 ? 0 : 255;
    expect(computeRmsLevel(buf)).toBeGreaterThan(0.9);
  });

  it('is between 0 and 1 and monotonic with amplitude', () => {
    const quiet = new Uint8Array(64).fill(138); // small deviation
    const loud = new Uint8Array(64).fill(200); // large deviation
    const q = computeRmsLevel(quiet);
    const l = computeRmsLevel(loud);
    expect(q).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(l).toBeGreaterThan(q);
  });

  it('returns 0 for an empty buffer', () => {
    expect(computeRmsLevel(new Uint8Array(0))).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-audio-level.test.ts`
Expected: FAIL — cannot resolve module `audio-level`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/(portal)/ai-interview/[token]/audio-level.ts
/**
 * RMS loudness of an 8-bit time-domain buffer (AnalyserNode.getByteTimeDomainData),
 * where 128 is silence. Returns a 0..1 level suitable for a mic meter.
 */
export function computeRmsLevel(timeDomain: Uint8Array): number {
  if (timeDomain.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const v = (timeDomain[i] - 128) / 128; // -1..1
    sumSquares += v * v;
  }
  const rms = Math.sqrt(sumSquares / timeDomain.length); // 0..1
  return Math.min(1, rms);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-audio-level.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/audio-level.ts" tests/access/ai-interview-audio-level.test.ts
git commit -m "feat(ai-interview): pure RMS mic-level helper"
```

---

## Task 4: AiOrb component

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/ai-orb.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (new file — created here, extended by later tasks)

**Interfaces:**
- Consumes: i18n keys `interviewer`, `aiSpeaking`, `aiListening` (Task 1).
- Produces: `function AiOrb({ state, size }: { state: 'speaking' | 'listening' | 'connecting'; size?: 'sm' | 'lg' }): JSX.Element`

- [ ] **Step 1: Write the failing tripwire test (creates the shared call-ui test file)**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `ai-orb.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/ai-orb.tsx
'use client';

import { useI18n } from '../../../../lib/i18n';

interface AiOrbProps {
  state: 'speaking' | 'listening' | 'connecting';
  size?: 'sm' | 'lg';
}

export function AiOrb({ state, size = 'lg' }: AiOrbProps) {
  const { t } = useI18n();
  const diameter = size === 'lg' ? 'w-28 h-28' : 'w-16 h-16';
  const label =
    state === 'speaking'
      ? t.aiInterview.aiSpeaking
      : state === 'listening'
        ? t.aiInterview.aiListening
        : t.aiInterview.connecting;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative flex items-center justify-center">
        {state === 'speaking' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-[#7c5cff]/30 animate-ping" />
        )}
        <span
          className={`relative ${diameter} rounded-full bg-[radial-gradient(circle_at_35%_30%,#7c5cff,#2a1866)] shadow-[0_0_0_8px_rgba(124,92,255,0.16)] transition-opacity ${
            state === 'listening' ? 'opacity-60' : 'opacity-100'
          } ${state === 'connecting' ? 'animate-pulse' : ''}`}
        />
      </div>
      <p className="text-xs text-[#b9b0e0]">
        {t.aiInterview.interviewer} · {label}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (ai-orb describe block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/ai-orb.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): AI voice orb component"
```

---

## Task 5: ParticipantTile component

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/participant-tile.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: i18n (caller passes a name string).
- Produces: `function ParticipantTile({ name, level, muted }: { name: string; level: number; muted: boolean }): JSX.Element` — `level` is 0..1; renders initials avatar + a mic-level bar; shows a muted indicator.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `participant-tile.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/participant-tile.tsx
'use client';

interface ParticipantTileProps {
  name: string;
  level: number; // 0..1 mic input level
  muted: boolean;
}

function initials(name: string): string {
  return name.trim().slice(0, 2).toUpperCase();
}

export function ParticipantTile({ name, level, muted }: ParticipantTileProps) {
  // Map 0..1 level to a 0..100 width class via inline-free Tailwind: use a scaleX transform class set.
  const bars = [0.15, 0.35, 0.55, 0.75, 0.95];
  return (
    <div className="flex-1 rounded-xl bg-[#241a3d] flex flex-col items-center justify-center gap-3 p-4">
      <div className="w-14 h-14 rounded-full bg-[#3a2d63] flex items-center justify-center text-sm text-[#cfc8ea]">
        {initials(name)}
      </div>
      <div className="flex items-end gap-1 h-5" aria-hidden>
        {bars.map((threshold) => (
          <span
            key={threshold}
            className={`w-1.5 rounded-sm transition-all ${
              !muted && level >= threshold ? 'h-5 bg-[#7c5cff]' : 'h-1.5 bg-[#3a2d63]'
            }`}
          />
        ))}
      </div>
      <p className="text-xs text-[#8a83ad]">
        {name}
        {muted ? ' · 🔇' : ''}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (participant-tile block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/participant-tile.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): audio-only participant tile with mic meter"
```

---

## Task 6: TranscriptPanel component

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/transcript-panel.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `TranscriptState` from `transcript.ts` (Task 2); i18n `liveTranscript`, `interviewer`, `you`.
- Produces: `function TranscriptPanel({ transcript, variant }: { transcript: TranscriptState; variant: 'panel' | 'focus' }): JSX.Element` — keys rows by `entry.id`; styles AI vs user differently; shows a caret on the trailing non-final entry.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `transcript-panel.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/transcript-panel.tsx
'use client';

import { useI18n } from '../../../../lib/i18n';
import type { TranscriptState } from './transcript';

interface TranscriptPanelProps {
  transcript: TranscriptState;
  variant: 'panel' | 'focus';
}

export function TranscriptPanel({ transcript, variant }: TranscriptPanelProps) {
  const { t } = useI18n();
  const container =
    variant === 'focus'
      ? 'w-full max-w-2xl mx-auto flex flex-col gap-2'
      : 'flex-1 min-h-0 overflow-y-auto rounded-xl bg-[#161226] p-3 flex flex-col gap-2';
  const lastIndex = transcript.entries.length - 1;

  return (
    <div className={container}>
      {variant === 'panel' && (
        <p className="text-[10px] uppercase tracking-wide text-[#8a83ad]">
          {t.aiInterview.liveTranscript}
        </p>
      )}
      {transcript.entries.map((entry, i) => {
        const who = entry.role === 'ai' ? t.aiInterview.interviewer : t.aiInterview.you;
        const live = i === lastIndex && !entry.final;
        const bubble =
          entry.role === 'ai'
            ? 'bg-[#221a3d] text-[#e9e6f5]'
            : 'bg-[#1c1733] text-[#9a91c4] self-end';
        return (
          <p key={entry.id} className={`text-sm rounded-lg px-3 py-2 ${bubble}`}>
            <span className="opacity-60">{who}: </span>
            {entry.text}
            {live && <span className="opacity-50">▍</span>}
          </p>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (transcript-panel block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/transcript-panel.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): live transcript panel (panel + focus variants)"
```

---

## Task 7: CallControls component

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/call-controls.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: i18n `muteMic`, `unmuteMic`, `callView`, `focusView`, `endInterview`.
- Produces: `function CallControls({ micMuted, onToggleMute, view, onToggleView, onEnd }: { micMuted: boolean; onToggleMute: () => void; view: 'call' | 'focus'; onToggleView: () => void; onEnd: () => void }): JSX.Element`

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `call-controls.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/call-controls.tsx
'use client';

import { useI18n } from '../../../../lib/i18n';

interface CallControlsProps {
  micMuted: boolean;
  onToggleMute: () => void;
  view: 'call' | 'focus';
  onToggleView: () => void;
  onEnd: () => void;
}

export function CallControls({ micMuted, onToggleMute, view, onToggleView, onEnd }: CallControlsProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-center gap-4">
      <button
        type="button"
        onClick={onToggleMute}
        aria-label={micMuted ? t.aiInterview.unmuteMic : t.aiInterview.muteMic}
        className="w-12 h-12 rounded-full bg-[#2a2148] text-white text-lg hover:bg-[#352a59] transition"
      >
        {micMuted ? '🔇' : '🎙'}
      </button>
      <button
        type="button"
        onClick={onToggleView}
        className="h-10 px-4 rounded-full bg-[#241a3d] text-[#cfc8ea] text-xs border border-[#3a2d63] hover:bg-[#2d2150] transition"
      >
        {view === 'call' ? t.aiInterview.focusView : t.aiInterview.callView}
      </button>
      <button
        type="button"
        onClick={onEnd}
        aria-label={t.aiInterview.endInterview}
        className="w-12 h-12 rounded-full bg-[#DD0C15] text-white text-lg hover:bg-[#b50a11] transition"
      >
        ✕
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (call-controls block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/call-controls.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): call control bar (mute/view/end)"
```

---

## Task 8: useMicLevel hook

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/use-mic-level.ts`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `computeRmsLevel` from `audio-level.ts` (Task 3).
- Produces: `function useMicLevel(active: boolean): number` — when `active`, opens a mic stream, samples via `AnalyserNode` on `requestAnimationFrame`, returns the latest 0..1 level; tears down the stream/context when inactive or on unmount.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `use-mic-level.ts` does not exist.

- [ ] **Step 3: Write the hook**

```ts
// apps/web/app/(portal)/ai-interview/[token]/use-mic-level.ts
import { useEffect, useState } from 'react';
import { computeRmsLevel } from './audio-level';

/**
 * Returns the current microphone input level (0..1) while `active`.
 * Opens its own preview stream + AudioContext and tears everything down
 * when `active` flips false or the component unmounts.
 */
export function useMicLevel(active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      setLevel(0);
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let raf = 0;
    let cancelled = false;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) return;
        ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          setLevel(computeRmsLevel(buf));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setLevel(0);
      }
    })();

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
    };
  }, [active]);

  return level;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (use-mic-level block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/use-mic-level.ts" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): useMicLevel hook for the lobby meter"
```

---

## Task 9: useInterviewCall hook (SDK + tRPC wiring)

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts`
- Modify: `tests/access/ai-interview-ui.test.ts` (move the SDK-wiring tripwires off `voice-room.tsx`)
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `applyTranscriptEvent`, `emptyTranscript`, `TranscriptState` (Task 2); `@elevenlabs/react` `useConversation`; `trpc.aiInterview.start`.
- Produces:
  - `type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error'`
  - `interface InterviewCall { status: CallStatus; isAiSpeaking: boolean; transcript: TranscriptState; micMuted: boolean; error: string | null; start: () => Promise<void>; end: () => void; toggleMute: () => void }`
  - `function useInterviewCall(candidateToken: string): InterviewCall`

**SDK verification note:** confirm the exact `@elevenlabs/react@1.7` fields during implementation — `useConversation` returns `status`, `startSession`, `endSession`, an `onMessage` callback with `{ source, message }`, and a speaking/mode signal. Use the real field for "AI speaking" (likely `isSpeaking` or `mode === 'speaking'`) and the real mic-mute API (likely `micMuted` + `setMicMuted` or `mute()`/`unmute()`). If a partial/tentative transcript event exists, feed it with `final: false`; otherwise map `onMessage` to `final: true`.

- [ ] **Step 1: Move the SDK tripwires to the hook (edit existing test first)**

In `tests/access/ai-interview-ui.test.ts`, the `describe('voice-room.tsx — ElevenLabs session')` block currently asserts `voice-room.tsx` contains `aiInterview.start`, `startSession`, `signedUrl`, `dynamicVariables`, `endSession`. Change that block to read `use-interview-call.ts` instead. Replace the `VOICE` constant usage in those specific assertions:

```ts
// add near the other path constants
const HOOK = `${AI_DIR}/use-interview-call.ts`;
```

Then in the `voice-room.tsx — ElevenLabs session` describe, repoint these assertions from `read(VOICE)` to `read(HOOK)`:
- "calls aiInterview.start mutation" → `expect(read(HOOK)).toContain('aiInterview.start');`
- "uses signedUrl from start response in startSession" → assert on `read(HOOK)`
- "forwards dynamicVariables from start to the session" → assert on `read(HOOK)`
- "renders an End button" → rename to "exposes endSession" → `expect(read(HOOK)).toContain('endSession');`
- "ELEVENLABS_API_KEY never appears client-side" → also assert `read(HOOK)` does not contain it.

Keep the `ConversationProvider` assertion pointing at `voice-room.tsx` (the provider stays there — Task 12). Keep the i18n/`no-any`/`no-inline-style` checks on `voice-room.tsx`.

- [ ] **Step 2: Add the hook tripwire to the call-ui test**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run tests/access/ai-interview-ui.test.ts tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `use-interview-call.ts` does not exist (both files reference it).

- [ ] **Step 4: Write the hook**

```ts
// apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts
import { useCallback, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { applyTranscriptEvent, emptyTranscript, type TranscriptState } from './transcript';

export type CallStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error';

export interface InterviewCall {
  status: CallStatus;
  isAiSpeaking: boolean;
  transcript: TranscriptState;
  micMuted: boolean;
  error: string | null;
  start: () => Promise<void>;
  end: () => void;
  toggleMute: () => void;
}

export function useInterviewCall(candidateToken: string): InterviewCall {
  const { t } = useI18n();
  const [transcript, setTranscript] = useState<TranscriptState>(emptyTranscript);
  const [error, setError] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [ended, setEnded] = useState(false);

  const conversation = useConversation({
    onConnect: () => setError(null),
    onMessage: (props: { source: string; message: string }) => {
      setTranscript((prev) =>
        applyTranscriptEvent(prev, {
          source: props.source === 'user' ? 'user' : 'ai',
          text: props.message,
          final: true,
        }),
      );
    },
    onDisconnect: () => setEnded(true),
    onError: (message: string) => {
      console.error('[ai-interview] SDK error:', message);
      setError(t.aiInterview.startError);
    },
  });

  const startMutation = trpc.aiInterview.start.useMutation({
    onError: (err) => {
      console.error('[ai-interview] start error:', err.message);
      setError(t.aiInterview.startError);
    },
  });

  const start = useCallback(async () => {
    setError(null);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t.aiInterview.micPermissionError);
      return;
    }
    startMutation.mutate(
      { candidateToken },
      {
        onSuccess: ({ signedUrl, dynamicVariables }) => {
          void conversation.startSession({ signedUrl, dynamicVariables });
        },
      },
    );
  }, [candidateToken, conversation, startMutation, t]);

  const end = useCallback(() => {
    void conversation.endSession();
  }, [conversation]);

  const toggleMute = useCallback(() => {
    setMicMuted((prev) => {
      const next = !prev;
      // SDK mic-mute API — verify exact name against @elevenlabs/react@1.7.
      conversation.micMuted = next;
      return next;
    });
  }, [conversation]);

  const status: CallStatus = ended
    ? 'ended'
    : error
      ? 'error'
      : conversation.status === 'connected'
        ? 'connected'
        : conversation.status === 'connecting' || startMutation.isPending
          ? 'connecting'
          : 'idle';

  // SDK speaking signal — verify exact field against @elevenlabs/react@1.7.
  const isAiSpeaking = Boolean(conversation.isSpeaking) && status === 'connected';

  return { status, isAiSpeaking, transcript, micMuted, error, start, end, toggleMute };
}
```

- [ ] **Step 5: Run both tests + tsc to verify they pass**

Run: `npx vitest run tests/access/ai-interview-ui.test.ts tests/access/ai-interview-call-ui.test.ts`
Expected: PASS.
Run: `cd apps/web && npx tsc --noEmit`
Expected: clean. (If the SDK field names differ, fix them here per the verification note — this is the only place they live.)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts" tests/access/ai-interview-ui.test.ts tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): useInterviewCall hook isolates EL + tRPC wiring"
```

---

## Task 10: Lobby screen

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/lobby.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `useMicLevel` (Task 8); i18n lobby keys (Task 1).
- Produces: `function Lobby({ onJoin, joining, error }: { onJoin: () => void; joining: boolean; error: string | null }): JSX.Element` — runs the mic preview meter, shows a join button that calls `onJoin`, and renders `error` inline when present.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `lobby.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/lobby.tsx
'use client';

import { useI18n } from '../../../../lib/i18n';
import { useMicLevel } from './use-mic-level';
import { ParticipantTile } from './participant-tile';

interface LobbyProps {
  onJoin: () => void;
  joining: boolean;
  error: string | null;
}

export function Lobby({ onJoin, joining, error }: LobbyProps) {
  const { t } = useI18n();
  const level = useMicLevel(true);

  return (
    <div className="min-h-screen bg-[#0E0A1F] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#160f2e] p-8 flex flex-col items-center gap-6">
        <h1 className="text-lg font-semibold text-white">{t.aiInterview.lobbyHeading}</h1>

        <div className="w-full flex flex-col items-center gap-2">
          <p className="text-[11px] uppercase tracking-wide text-[#8a83ad]">
            {t.aiInterview.lobbyMicCheck}
          </p>
          <div className="w-40">
            <ParticipantTile name={t.aiInterview.you} level={level} muted={false} />
          </div>
          {level > 0.05 && <p className="text-xs text-[#5fd07a]">{t.aiInterview.lobbyMicWorking}</p>}
        </div>

        {error && (
          <div className="w-full text-xs text-[#ff8a8f] bg-[#3a1414] px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onJoin}
          disabled={joining}
          className="w-full h-12 rounded-xl bg-[#7c5cff] text-white text-sm font-semibold hover:bg-[#6b4ce0] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {joining ? t.aiInterview.loading : t.aiInterview.lobbyJoin}
        </button>
      </div>
    </div>
  );
}
```

(The mic-device picker from the spec is rendered when `navigator.mediaDevices.enumerateDevices` returns more than one `audioinput`; for the first cut the single-device preview above satisfies the spec's mic-check requirement. If multiple inputs are common in testing, add a `<select>` bound to a `deviceId` and pass it into `getUserMedia` — keep it inside this file, no inline styles, label via `t.aiInterview.lobbyMicDevice`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (lobby block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/lobby.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): pre-call lobby with mic check"
```

---

## Task 11: CallShell (layout + view modes)

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend)

**Interfaces:**
- Consumes: `InterviewCall` (Task 9); `AiOrb` (Task 4); `ParticipantTile` (Task 5); `TranscriptPanel` (Task 6); `CallControls` (Task 7); i18n.
- Produces: `function CallShell({ call }: { call: InterviewCall }): JSX.Element` — owns local `view` state (`'call' | 'focus'`), renders the top bar (timer + status + toggle), the active view, and the control bar. Toggling `view` never remounts anything that holds the conversation.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `call-shell.tsx` does not exist.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx
'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import type { InterviewCall } from './use-interview-call';
import { AiOrb } from './ai-orb';
import { ParticipantTile } from './participant-tile';
import { TranscriptPanel } from './transcript-panel';
import { CallControls } from './call-controls';

function useElapsed(running: boolean): string {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function CallShell({ call }: { call: InterviewCall }) {
  const { t } = useI18n();
  const [view, setView] = useState<'call' | 'focus'>('call');
  const elapsed = useElapsed(call.status === 'connected');
  const orbState =
    call.status === 'connecting'
      ? 'connecting'
      : call.isAiSpeaking
        ? 'speaking'
        : 'listening';
  const statusLabel =
    call.status === 'connected'
      ? t.aiInterview.connected
      : call.status === 'reconnecting'
        ? t.aiInterview.reconnecting
        : t.aiInterview.connecting;

  return (
    <div className="min-h-screen bg-[#0E0A1F] flex flex-col text-white">
      <header className="flex items-center justify-between px-5 py-3 text-xs text-[#9a92c0]">
        <span>🔴 {elapsed} · {t.aiInterview.title} · {statusLabel}</span>
      </header>

      <main className="flex-1 min-h-0 px-5 pb-4">
        {view === 'call' ? (
          <div className="h-full flex gap-4">
            <div className="flex-1 flex flex-col gap-4">
              <div className="flex-1 rounded-xl bg-[#160f2e] border-2 border-[#7c5cff] flex items-center justify-center">
                <AiOrb state={orbState} size="lg" />
              </div>
              <ParticipantTile name={t.aiInterview.you} level={call.micMuted ? 0 : 0.4} muted={call.micMuted} />
            </div>
            <div className="w-[42%] flex flex-col">
              <TranscriptPanel transcript={call.transcript} variant="panel" />
            </div>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center gap-6 pt-8 overflow-y-auto">
            <AiOrb state={orbState} size="lg" />
            <TranscriptPanel transcript={call.transcript} variant="focus" />
          </div>
        )}
      </main>

      <footer className="px-5 py-4">
        <CallControls
          micMuted={call.micMuted}
          onToggleMute={call.toggleMute}
          view={view}
          onToggleView={() => setView((v) => (v === 'call' ? 'focus' : 'call'))}
          onEnd={call.end}
        />
      </footer>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: PASS (call-shell block).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): call shell with Call/Focus view toggle"
```

---

## Task 12: Rewrite voice-room.tsx (screen state machine) + full gate

**Files:**
- Modify: `apps/web/app/(portal)/ai-interview/[token]/voice-room.tsx`
- Test: `tests/access/ai-interview-call-ui.test.ts` (extend), `tests/access/ai-interview-ui.test.ts` (already updated in Task 9)

**Interfaces:**
- Consumes: `useInterviewCall` (Task 9), `Lobby` (Task 10), `CallShell` (Task 11).
- Produces: `VoiceRoom` (unchanged export name) — `ConversationProvider` boundary + a `VoiceRoomInner` that maps call status → screen: `idle/error` → `Lobby`, `connecting/connected/reconnecting` → `CallShell`, `ended` → Completed.

- [ ] **Step 1: Add the failing tripwire**

Append to `tests/access/ai-interview-call-ui.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts`
Expected: FAIL — `voice-room.tsx` does not yet reference `useInterviewCall`/`Lobby`/`CallShell`.

- [ ] **Step 3: Rewrite the file**

```tsx
// apps/web/app/(portal)/ai-interview/[token]/voice-room.tsx
'use client';

import { ConversationProvider } from '@elevenlabs/react';
import { useI18n } from '../../../../lib/i18n';
import { useInterviewCall } from './use-interview-call';
import { Lobby } from './lobby';
import { CallShell } from './call-shell';

function VoiceRoomInner({ candidateToken }: { candidateToken: string }) {
  const { t } = useI18n();
  const call = useInterviewCall(candidateToken);

  if (call.status === 'ended') {
    return (
      <div className="min-h-screen bg-[#0E0A1F] flex items-center justify-center p-4">
        <div className="rounded-2xl bg-[#160f2e] p-8 max-w-md w-full text-center">
          <p className="text-sm text-[#cfc8ea]">{t.aiInterview.completed}</p>
        </div>
      </div>
    );
  }

  if (call.status === 'connecting' || call.status === 'connected' || call.status === 'reconnecting') {
    return <CallShell call={call} />;
  }

  // idle or error → lobby (error is shown inline on the lobby)
  return <Lobby onJoin={() => void call.start()} joining={false} error={call.error} />;
}

export function VoiceRoom({ candidateToken }: { candidateToken: string }) {
  return (
    <ConversationProvider>
      <VoiceRoomInner candidateToken={candidateToken} />
    </ConversationProvider>
  );
}
```

- [ ] **Step 4: Run the targeted tests**

Run: `npx vitest run tests/access/ai-interview-call-ui.test.ts tests/access/ai-interview-ui.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Full gate**

Run: `pnpm --filter @tims/api exec tsc --noEmit` → clean
Run: `cd apps/web && npx tsc --noEmit` → clean
Run: `npx vitest run` (repo root) → all green (1109 prior + the new transcript/audio-level/call-ui tests)
Run: `cd apps/web && npx next build` → exit 0

- [ ] **Step 6: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/voice-room.tsx" tests/access/ai-interview-call-ui.test.ts
git commit -m "feat(ai-interview): voice-room screen state machine (lobby → call → completed)"
```

---

## Post-implementation: live verification (manual, not a code step)

After the gate is green and the branch is deployed/run locally with ElevenLabs configured:

1. Open a candidate link → consent → **lobby** shows the mic meter reacting to your voice → "Unirse a la entrevista".
2. Call connects → **Call view**: orb pulses while the AI talks, dims while it listens; transcript streams; candidate tile shows mic level. Toggle to **Focus view** mid-sentence → no audio drop, transcript continues.
3. **Mute** stops your audio (AI stops responding to you); unmute resumes.
4. **End** → "entrevista completada"; recruiter result panel later shows summary/bias/fit (unchanged backend).
5. Confirm the SDK field assumptions from Task 9 (speaking signal, mic-mute API, partial transcript events) against the live session; adjust `use-interview-call.ts` only if needed.
6. Watch DevTools console for any ElevenLabs CSP domain not already allowlisted; report for a follow-up CSP tweak.
