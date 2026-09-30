import { beforeEach, describe, expect, it, vi } from 'vitest';

// Company self-signup (apps/web/app/auth/callback/route.ts) derives the new organization's
// slug from `company_name`. Pins that accents are folded (not turned into hyphens) and that
// the derived part is capped at 50 chars before the base-36 uniqueness suffix is appended.

const state = vi.hoisted(() => ({
  companyName: '',
  orgCreates: [] as Array<{ data: { slug: string; name: string } }>,
}));

// Mocked by file path: apps/web resolves '@tims/auth/server' through its workspace symlink,
// which lands on this same module id (there is no root alias for it).
vi.mock('../../packages/auth/src/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({
        data: {
          user: {
            id: 'supabase-user-1',
            email: 'founder@example.com',
            user_metadata: { account_type: 'company', company_name: state.companyName, full_name: 'Ana Pérez' },
          },
        },
      }),
    },
  }),
}));

vi.mock('@tims/db', () => {
  const tx = {
    organization: {
      create: vi.fn(async (args: { data: { slug: string; name: string } }) => {
        state.orgCreates.push(args);
        return { id: 'org-1' };
      }),
    },
    role: { findUniqueOrThrow: vi.fn(async () => ({ id: 'role-1' })) },
    user: { create: vi.fn(async () => ({ id: 'user-1' })) },
    userRole: { create: vi.fn(async () => ({})) },
    subscription: { create: vi.fn(async () => ({})) },
  };
  return {
    db: {
      user: { findFirst: vi.fn(async () => null) },
      platformOwnerEmail: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('@tims/api', () => ({
  provisionOrgDefaults: vi.fn(async () => ({})),
  provisionOrgEntitlements: vi.fn(async () => undefined),
  provisionOrgRoles: vi.fn(async () => undefined),
}));

import { GET } from '../../apps/web/app/auth/callback/route';

async function signUp(companyName: string): Promise<string> {
  state.companyName = companyName;
  const response = await GET(new Request('https://ats.example.com/auth/callback?code=abc&type=company'));
  expect(response.headers.get('location')).toBe('https://ats.example.com/dashboard');
  expect(state.orgCreates).toHaveLength(1);
  return state.orgCreates[0]!.data.slug;
}

describe('company self-signup slug', () => {
  beforeEach(() => {
    state.orgCreates = [];
  });

  it('folds accents instead of hyphenating them', async () => {
    const slug = await signUp('Logística Andina S.A.S.');
    expect(slug).toMatch(/^logistica-andina-s-a-s-[0-9a-z]+$/);
    expect(state.orgCreates[0]!.data.name).toBe('Logística Andina S.A.S.');
  });

  it('caps the name-derived part at 50 chars before the uniqueness suffix', async () => {
    const slug = await signUp(`Compañía ${'Muy Larga '.repeat(10)}`);
    const derived = slug.slice(0, slug.lastIndexOf('-'));
    expect(derived.startsWith('compania-muy-larga')).toBe(true);
    expect(derived.length).toBeLessThanOrEqual(50);
    expect(derived.endsWith('-')).toBe(false);
  });
});
