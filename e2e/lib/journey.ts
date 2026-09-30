import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { STATE_DIR, type Credentials } from './stack';

/**
 * Per-run identity. global-setup.ts sets E2E_RUN_ID once per `playwright test` invocation, so every
 * email, slug and title created by a run is unique and reruns never collide with earlier data.
 */
export function runId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id) throw new Error('[e2e] E2E_RUN_ID is not set — run through `playwright test` (global-setup sets it)');
  return id;
}

/** A strong random password for a user the suite creates (local stack only; never printed). */
export function newPassword(): string {
  return `E2e-${randomBytes(12).toString('base64url')}!9`;
}

/**
 * What the company journey hands to the candidate journey. Persisted to e2e/.state because the two
 * run as separate Playwright projects (candidate depends on company). Created by the UI under test —
 * this file only remembers ids and credentials, it never fabricates app state.
 */
export interface JourneyState {
  runId: string;
  orgName: string;
  orgSlug: string;
  admin: Credentials & { firstName: string; lastName: string };
  recruiter: Credentials & { firstName: string; lastName: string };
  leader: Credentials & { firstName: string; lastName: string };
  vacancy?: { id: string; title: string };
}

function stateFile(): string {
  return join(STATE_DIR, `journey-${runId()}.json`);
}

export function saveJourney(state: JourneyState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function loadJourney(): JourneyState {
  const file = stateFile();
  if (!existsSync(file)) {
    throw new Error(`[e2e] ${file} missing — the candidate journey needs the company journey of the same run`);
  }
  return JSON.parse(readFileSync(file, 'utf8')) as JourneyState;
}

/**
 * The company and people the company journey creates, derived from the run id. `retry` is the
 * Playwright retry index: a serial group retries from its first test, so a retry needs fresh
 * identities rather than colliding with the org its failed attempt already created.
 */
export function newJourney(retry = 0): JourneyState {
  const id = retry > 0 ? `${runId()}r${retry}` : runId();
  const at = (local: string) => `${local}.${id}@e2e-andina.test`;
  return {
    runId: id,
    orgName: `Andina Logística E2E ${id}`,
    orgSlug: `andina-e2e-${id}`,
    admin: { email: at('admin'), password: newPassword(), firstName: 'Valentina', lastName: 'Restrepo' },
    recruiter: { email: at('reclutador'), password: newPassword(), firstName: 'Mateo', lastName: 'Gómez' },
    leader: { email: at('lider'), password: newPassword(), firstName: 'Laura', lastName: 'Mejía' },
  };
}
