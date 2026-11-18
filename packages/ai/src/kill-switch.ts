import { TRPCError } from '@trpc/server';

// ---------------------------------------------------------------------------
// Global AI kill switch — ONE environment variable that stops every model call
// made through @tims/ai, for every organization and every agent.
//
//   AI_KILL_SWITCH unset / '' / 'false' / '0' / 'off' / 'no'  → AI runs (default)
//   AI_KILL_SWITCH set to anything else ('true', '1', 'yes'…)  → every call is refused
//
// The polarity is deliberately the opposite of the opt-in feature flags in this
// repo (which enable only on the exact string 'true'): this is a STOP control, so
// an unrecognised value fails CLOSED. An operator who types 'TRUE' or 'yes' in an
// emergency gets the stop they asked for, never a silent no-op.
//
// Read on EVERY call (never captured at import time), so a process that is still
// warm picks the value up as soon as its environment changes.
//
// Enforced at both doors: `invokeAgent` (before any catalog, budget or cache read,
// so a stopped platform performs no AI-related database work at all) and the raw
// `bedrockGenerate` (so nothing that reaches the model client can bypass it).
//
// Scope: Bedrock calls made through this package. The AI voice interview runs on
// ElevenLabs, not through `invokeAgent`; its session-start gate
// (`assertVoiceSessionWithinCap` in voice-cap.ts) checks this switch as well.
// The refusal is a TRPCError SERVICE_UNAVAILABLE — the same error family the
// gated path already throws on budget exhaustion — carrying a stable machine code
// that apps/web localizes wherever an error toast is shown.
// ---------------------------------------------------------------------------

/** The environment variable name. */
export const AI_KILL_SWITCH_ENV = 'AI_KILL_SWITCH';

/** Stable machine code carried as the TRPCError message when the switch is on. */
export const AI_DISABLED = 'ai_disabled';

const OFF_VALUES: ReadonlySet<string> = new Set(['', 'false', '0', 'off', 'no']);

/** True when the switch is on. `value` defaults to the live environment, read per call. */
export function isAiKillSwitchOn(value: string | undefined = process.env[AI_KILL_SWITCH_ENV]): boolean {
  if (value === undefined) return false;
  return !OFF_VALUES.has(value.trim().toLowerCase());
}

/** The typed refusal every entry point throws while the switch is on. */
export function aiDisabledError(): TRPCError {
  return new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: AI_DISABLED });
}

/** Throw {@link aiDisabledError} when the switch is on; no-op otherwise. */
export function assertAiEnabled(): void {
  if (isAiKillSwitchOn()) throw aiDisabledError();
}
