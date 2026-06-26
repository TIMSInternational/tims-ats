# AI Voice Interview — Conversational Call Redesign

> Date: 2026-06-26 · Status: approved (design) · Branch: `feat/ai-interview-call-redesign`
> Builds on: `docs/superpowers/specs/2026-06-24-ai-voice-interview-design.md` (the AI voice interview itself)

## Overview

The AI voice interview already works end-to-end: a candidate opens a magic-link, consents,
and has a real-time spoken conversation with an ElevenLabs Conversational-AI interviewer; on
hang-up the transcript is analyzed (summary + bias + fit) for the recruiter. Today the
candidate side renders in a small centered card with a Start/End button.

This project redesigns **only the candidate call experience** into a full-screen, Zoom-style
conversational call: a 1:1 call between the candidate and the AI, with a real AI voice, snappy
turn-taking, a live transcript, and a switchable layout. The voice/latency/transcript plumbing
already exists (ElevenLabs `@elevenlabs/react`); this is primarily a frontend redesign plus a
refactor of the candidate page into focused components.

## Goals

- A polished, full-screen "call" UI that feels like joining a video call (dark themed).
- Two switchable view modes the candidate can toggle at any time:
  - **Call view** (default) — AI tile + candidate tile + always-visible live transcript panel.
  - **Focus view** — large AI voice orb + center-stage live transcript.
- Clear AI presence: a voice orb that visibly **pulses while the AI speaks** and **dims/settles
  while it listens**.
- **Audio-only** participants (no camera): the candidate tile is an animated avatar with a
  mic-level meter. The AI is voice-only.
- A **live transcript** that streams the AI's words as it speaks and keeps a scrollable history
  of both the AI's and the candidate's turns.
- A short **lobby** (mic check) before the call, after the existing consent screen.
- Keep the conversation feeling immediate (low latency) by tuning the ElevenLabs agent's
  turn-taking; no transport change.

## Non-Goals (explicit follow-ups, not this round)

- Candidate **camera/video** (the AI doesn't use video).
- **Recruiter-in-call** / multi-party / live observation.
- Making **"AI Voice" a schedulable interview type** in the scheduling flow (still launched
  ad-hoc from an interview row, as today).
- Migrating ElevenLabs transport from **WebSocket → WebRTC** (current WS is already real-time
  low-latency; revisit only if testing shows it's not enough).
- Any change to the **backend**: `aiInterview.start` (signed URL / fail-closed gates / org voice
  budget), the post-call **webhook**, and the **analysis** pipeline are unchanged.

## User Flow & Screens

1. **Magic link** `/ai-interview/<candidateToken>` (unchanged; public route).
2. **Consent + AI disclosure** — existing `consent-screen.tsx`, unchanged (compliance: consent,
   AI disclosure, stored consent via `recordConsent`).
3. **Lobby** (new) — a "ready to join" screen:
   - Requests mic permission and shows a **live input-level meter** so the candidate sees their
     mic works.
   - **Mic picker** when multiple input devices exist (`enumerateDevices`); remembers the choice
     for the call.
   - Primary **"Unirse a la entrevista"** button → enters the call (calls `aiInterview.start`
     and opens the ElevenLabs session).
   - Surfaces start failures (budget/EL-not-configured/expired) inline, reusing existing i18n
     error keys.
4. **Call screen** (the redesign) — see below.
5. **Completed** — existing "entrevista completada" state, lightly restyled to match the call
   theme. (Analysis runs server-side for the recruiter, unchanged.)

## Call Screen

Full-screen, dark "call" theme. One screen with **two view modes** toggled by a control in the
top bar; the active conversation is never interrupted by toggling.

### Shared chrome

- **Top bar:** elapsed **timer**, "Entrevista IA" label, **connection status**
  (conectando / conectado / reconectando), and the **view-mode toggle** (Call ⤢ Focus).
- **Bottom control bar:**
  - **Mute mic** — toggles the local microphone via the SDK (`micMuted`); reflects state.
  - **View toggle** — same as top-bar toggle (also placed here for reach).
  - **End call** — ends the session (`endSession`) → Completed screen.

### View mode: Call view (default)

- **AI tile:** the voice **orb** (see AI presence) + label "Entrevistador IA" with a
  speaking/listening sub-state.
- **Candidate tile:** audio-only **avatar** (initials) with a **mic-level meter** driven by the
  local audio stream; label "Tú".
- **Transcript panel:** always visible alongside the tiles; live transcript (below).

### View mode: Focus view

- Large centered **orb** + speaking/listening label.
- **Center-stage transcript**: larger type, the AI's current utterance streams in (typewriter
  feel) with prior turns above it. Best for reading along / accessibility.

### AI presence (the orb)

A single reusable `AiOrb` component with visual states derived from the SDK:

- **speaking** — animated pulse / glow rings (AI is producing audio).
- **listening** — calm, dimmed, subtle idle motion (candidate's turn).
- **connecting** — indeterminate shimmer.

State source: the `@elevenlabs/react` conversation's speaking/mode signal (e.g.
`conversation.isSpeaking` / `mode`). Exact field verified against the installed SDK during
implementation; the component takes a typed `state` prop so the data source is swappable.

### Live transcript

- Streams the AI's words **as granularly as the SDK exposes** them. The current code appends a
  finalized message per turn via `onMessage`; the redesign renders a **"live" current line** for
  the in-progress AI utterance plus a **finalized history** of completed turns (AI + candidate).
- If the SDK only emits finalized turns (no token/partial events in `@elevenlabs/react@1.7`), the
  live line shows the most recent finalized AI turn with a typewriter reveal; history behaves as
  today. This is an **implementation-time verification item** — design works either way; only the
  granularity of "live" changes.
- Auto-scrolls to newest; transcript entries keyed by a stable id (not array index).

## Architecture & Components

Refactor the single `voice-room.tsx` (currently ~160 lines, mixing connection logic + UI) into
focused units under `apps/web/app/(portal)/ai-interview/[token]/`, each with one purpose and
well under the 300-line component limit:

- `useInterviewCall.ts` — hook that owns the call lifecycle: wraps `useConversation`, runs the
  `aiInterview.start` mutation, exposes `{ status, isSpeaking/mode, transcript, micMuted,
  toggleMute, start, end, error }`. The single place that talks to the SDK + tRPC.
- `lobby.tsx` — mic permission + level meter + device picker + "join" button.
- `call-shell.tsx` — full-screen layout, top bar (timer/status/toggle), control bar, and the
  view-mode switch; renders Call view or Focus view.
- `ai-orb.tsx` — the orb with `state` prop (speaking/listening/connecting).
- `participant-tile.tsx` — audio-only avatar + mic-level meter (used for the candidate; the AI
  tile reuses `AiOrb`).
- `transcript-panel.tsx` — live + finalized transcript rendering (used by both view modes).
- `call-controls.tsx` — mute / view-toggle / end buttons.
- `voice-room.tsx` — slimmed to the `ConversationProvider` boundary + screen state machine
  (lobby → call → completed), delegating to the above.

All visual styling uses existing Tailwind tokens/conventions; all copy goes through `lib/i18n`
(es/en), extending the existing `aiInterview` message group — no hardcoded strings.

## Data Flow

```
Lobby "Join" ─▶ useInterviewCall.start()
                 ├─ getUserMedia(audio) (already granted in lobby; reused)
                 ├─ aiInterview.start({ candidateToken }) ─▶ { signedUrl, dynamicVariables }
                 └─ conversation.startSession({ signedUrl, dynamicVariables })
SDK events ─▶ onConnect/onDisconnect/onError ─▶ status
            ─▶ onMessage (+ partials if available) ─▶ transcript (live line + history)
            ─▶ speaking/mode ─▶ AiOrb state + tile emphasis
Controls ─▶ toggleMute / endSession
End ─▶ Completed screen (server-side webhook → analysis, unchanged)
```

No new tRPC procedures, no schema changes, no new env. The mic-level meter reads the local
`MediaStream` via the Web Audio API (`AnalyserNode`) entirely client-side.

## Error / Edge Handling

- **Mic denied** in lobby → clear inline message + retry; cannot join without mic.
- **start failure** (budget exhausted, EL not configured, token expired/used) → inline error on
  the lobby, reusing existing i18n keys; no half-open call state.
- **Mid-call disconnect/error** → status shows "reconectando"; on terminal failure, route to a
  graceful "call ended" state (no stack traces). Transcript captured so far stays on screen.
- **Toggle during connecting/speaking** → pure view change; never tears down the session.

## Testing

- **Component tests** (vitest + existing RTL setup):
  - `useInterviewCall` — start success wires session; start error surfaces; end calls
    `endSession`; mute toggles; transcript reducer appends finalized turns and updates the live
    line; SDK callbacks map to status.
  - `lobby` — mic-denied path blocks join; join triggers start; device list renders when
    multiple inputs.
  - `transcript-panel` — renders AI + candidate turns, streaming line, stable keys, autoscroll
    container present.
  - `call-shell` — view toggle switches modes without remounting the conversation provider;
    controls fire their handlers.
  - `ai-orb` — renders each `state` without error.
- Mock `@elevenlabs/react` and `getUserMedia`/Web Audio as in existing tests.
- Keep the full suite green (currently 1109) and `tsc` clean on `@tims/api` + web; `next build`
  passes.

## Open Implementation-Time Items (resolve in code, not blocking design)

1. **Transcript streaming granularity** — confirm whether `@elevenlabs/react@1.7` exposes
   token/partial transcript events; if not, use the typewriter-on-finalized fallback.
2. **Speaking/mode field name** — confirm the exact SDK signal for "AI is speaking" and mic-mute
   API; isolate behind `useInterviewCall` so the rest of the UI is decoupled.
3. **Turn-taking tuning** — adjust the ElevenLabs agent's turn-taking / interruption settings for
   snappy responses (agent-side config, not code); validate during the live test.
