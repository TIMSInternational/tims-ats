import { test } from '@playwright/test';

/**
 * Journey steps whose product fix is not on `main` yet. Each spec for such a step is written against
 * the INTENDED UI and marked `test.fixme` through `needs()`, so the suite is green on main and the
 * step switches on when its PR merges: set `merged: true` for that entry (one line), and any
 * main-only workaround step guarded by `supersededBy()` switches off in the same change.
 *
 * Keep this table in sync with the fixme → PR table in e2e/README.md.
 */
export const PENDING = {
  offerSigningPublic: {
    ref: '#300',
    why: '/offers/sign is not a public route on main — a signed-out candidate is bounced to /login',
    merged: true,
  },
  cvUploadCsp: {
    // #300 allows only the exact *.amazonaws.com bucket origin, so against LocalStack the upload stays
    // blocked even after it merges; it additionally needs a CSP allowance for a configured S3 endpoint.
    ref: '#300 + a CSP allowance for a non-AWS (LocalStack) S3 endpoint',
    why: 'the CSP connect-src blocks the CV upload POST to S3 on main',
    merged: false,
  },
  explicitConsent: {
    ref: '#302',
    why: 'the apply form has no explicit data-processing consent checkbox on main',
    merged: true,
  },
  scorecards: {
    ref: '#303',
    why: '"Enviar Scorecard" in the interview room is not wired to any mutation on main',
    merged: true,
  },
  peopleDirectory: {
    ref: '#304',
    why: 'recruiters get 403 from the approver/evaluator pickers (user.list needs user.read) on main',
    merged: true,
  },
  tenantInvitations: {
    ref: '#307',
    why: 'a company admin has no UI to invite their own team on main (only the platform owner can)',
    merged: true,
  },
  orgStructure: {
    ref: '#310',
    why: 'a new company has no teams/team leaders, so a leader is never in scope to approve',
    merged: true,
  },
  candidateEmails: {
    ref: '#308',
    why: 'no "application received" email is sent to candidates on main',
    merged: false,
  },
  onboardingDefaults: {
    ref: '#309',
    why: 'onboarding plans are created with zero tasks on main (no default template)',
    merged: true,
  },
} as const;

export type PendingKey = keyof typeof PENDING;

/** Mark the current test fixme until the fix for `key` is on main. Call first thing in the test. */
export function needs(...keys: PendingKey[]): void {
  const open = keys.filter((k) => !PENDING[k].merged);
  test.fixme(open.length > 0, open.map((k) => `needs ${PENDING[k].ref}: ${PENDING[k].why}`).join('; '));
}

/**
 * For a main-only workaround step (e.g. the admin doing what a recruiter cannot do yet): skip it once
 * the fix for `key` has merged, because the real step then runs instead.
 */
export function supersededBy(...keys: PendingKey[]): void {
  const allMerged = keys.every((k) => PENDING[k].merged);
  test.skip(
    allMerged,
    `superseded: ${keys.map((k) => PENDING[k].ref).join(', ')} merged — the intended step runs instead`,
  );
}
