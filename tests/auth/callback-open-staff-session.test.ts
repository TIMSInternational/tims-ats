import { beforeEach, describe, expect, it, vi } from 'vitest';

// E-19 / issue #410: a candidate's emailed portal link opened in a browser where a STAFF account is signed in
// must not silently replace that session. The callback skips the exchange and sends the candidate to the
// portal login with ?error=open_session (which explains it and offers a sign-out). Mocks follow
// tests/auth/callback-redirect-and-no-access.test.ts.

const state = vi.hoisted(() => ({
  currentUser: null as null | { id: string; email: string },
  staffRow: null as null | { id: string },
  exchanged: 0,
}));

vi.mock('../../packages/auth/src/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => {
        state.exchanged += 1;
        state.currentUser = { id: 'candidate-sub', email: 'candidate@example.com' };
        return { error: null };
      },
      getUser: async () => ({ data: { user: state.currentUser ? { ...state.currentUser, user_metadata: {} } : null } }),
      signOut: async () => ({ error: null }),
    },
  }),
}));
vi.mock('@tims/db', () => ({
  db: {
    user: {
      findFirst: vi.fn(async ({ where }: { where: { supabaseUserId: string } }) =>
        where.supabaseUserId === 'staff-sub' ? state.staffRow : null,
      ),
      create: vi.fn(),
    },
    platformOwnerEmail: { findUnique: vi.fn(async () => null) },
    $transaction: vi.fn(),
  },
}));
vi.mock('@tims/api', () => ({
  provisionOrgDefaults: vi.fn(),
  provisionOrgEntitlements: vi.fn(),
  provisionOrgRoles: vi.fn(),
}));

import { GET } from '../../apps/web/app/auth/callback/route';

const BASE = 'https://ats.example.com';
const portalLink = `code=abc&next=${encodeURIComponent('/careers/invu/dashboard')}`;
const call = async (qs: string) => (await GET(new Request(`${BASE}/auth/callback?${qs}`))).headers.get('location');

beforeEach(() => {
  state.currentUser = null;
  state.staffRow = null;
  state.exchanged = 0;
});

describe('/auth/callback portal link over an open staff session (E-19)', () => {
  it('does not exchange the code and sends the candidate to the portal login with open_session', async () => {
    state.currentUser = { id: 'staff-sub', email: 'recruiter@invu.example' };
    state.staffRow = { id: 'user-1' };
    expect(await call(portalLink)).toBe(`${BASE}/careers/invu/login?error=open_session`);
    expect(state.exchanged).toBe(0);
  });

  it('signs the candidate in as before when no session is open', async () => {
    expect(await call(portalLink)).toBe(`${BASE}/careers/invu/dashboard`);
    expect(state.exchanged).toBe(1);
  });

  it('does not stop a browser whose open session is not a staff account', async () => {
    state.currentUser = { id: 'other-candidate-sub', email: 'other@example.com' };
    expect(await call(portalLink)).toBe(`${BASE}/careers/invu/dashboard`);
    expect(state.exchanged).toBe(1);
  });
});
