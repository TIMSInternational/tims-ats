import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@tims/shared';

// #213, writer 4: the self-serve signup in apps/web/app/auth/callback/route.ts writes the identity
// provider's email into organizations.billing_email and users.email, and derives the default company
// name from its domain. Owner decision: REJECT out-of-bounds values (never truncate), BEFORE any write,
// redirect to /login with a generic code, and log a structured warning that does not contain the email.

const state = vi.hoisted(() => ({
  email: '',
  accountType: 'company' as string | undefined,
  isPlatformOwner: false,
  writes: [] as string[],
  signOuts: 0,
}));

vi.mock('../../packages/auth/src/server', () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: null }),
      getUser: async () => ({
        data: {
          user: {
            id: 'supabase-user-1',
            email: state.email,
            user_metadata: { account_type: state.accountType, full_name: 'Ana Pérez' },
          },
        },
      }),
      signOut: async () => {
        state.signOuts += 1;
        return { error: null };
      },
    },
  }),
}));

vi.mock('@tims/db', () => {
  const record = (name: string) =>
    vi.fn(async () => {
      state.writes.push(name);
      return { id: `${name}-1` };
    });
  const tx = {
    organization: { create: record('organization.create') },
    role: { findUniqueOrThrow: vi.fn(async () => ({ id: 'role-1' })) },
    user: { create: record('tx.user.create') },
    userRole: { create: record('userRole.create') },
    subscription: { create: record('subscription.create') },
  };
  return {
    db: {
      user: { findFirst: vi.fn(async () => null), create: record('user.create') },
      platformOwnerEmail: { findUnique: vi.fn(async () => (state.isPlatformOwner ? { email: state.email } : null)) },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => {
        state.writes.push('$transaction');
        return fn(tx);
      }),
    },
  };
});

vi.mock('@tims/api', () => ({
  provisionOrgDefaults: vi.fn(async () => {
    state.writes.push('provisionOrgDefaults');
  }),
  provisionOrgEntitlements: vi.fn(async () => {
    state.writes.push('provisionOrgEntitlements');
  }),
  provisionOrgRoles: vi.fn(async () => {
    state.writes.push('provisionOrgRoles');
  }),
}));

import { GET } from '../../apps/web/app/auth/callback/route';
import { checkSignupEmail } from '../../apps/web/lib/signup-email';

const ORIGIN = 'https://ats.example.com';
const REJECTED = `${ORIGIN}/login?error=signup_email_invalid`;

/** A syntactically valid hostname of exactly `length` characters (labels of ≤63, TLD "com"). */
function hostnameOfLength(length: number): string {
  const labels: string[] = [];
  let remaining = length - '.com'.length;
  while (remaining > 0) {
    const separator = labels.length ? 1 : 0;
    const take = Math.min(63, remaining - separator);
    labels.push('b'.repeat(take));
    remaining -= take + separator;
  }
  const host = `${labels.join('.')}.com`;
  expect(host.length).toBe(length);
  return host;
}

async function callback(email: string, opts: { accountType?: string; owner?: boolean } = {}) {
  state.email = email;
  state.accountType = opts.accountType;
  state.isPlatformOwner = opts.owner ?? false;
  const type = opts.accountType === 'company' ? '&type=company' : '';
  const response = await GET(new Request(`${ORIGIN}/auth/callback?code=abc${type}`));
  return response.headers.get('location');
}

describe('auth callback: identity-provider email bounds (#213)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    state.writes = [];
    state.signOuts = 0;
    warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('rejects a company signup whose email is longer than 254 chars, writing nothing', async () => {
    const email = `${'a'.repeat(64)}@${hostnameOfLength(190)}`; // 255 chars, domain itself valid
    expect(email.length).toBe(255);

    expect(await callback(email, { accountType: 'company' })).toBe(REJECTED);
    expect(state.writes).toEqual([]);
    expect(state.signOuts).toBe(1);
  });

  it('accepts a company signup whose email is exactly 254 chars', async () => {
    const email = `${'a'.repeat(63)}@${hostnameOfLength(190)}`;
    expect(email.length).toBe(254);

    expect(await callback(email, { accountType: 'company' })).toBe(`${ORIGIN}/dashboard`);
    expect(state.writes).toContain('organization.create');
    expect(state.signOuts).toBe(0);
  });

  it('rejects a company signup whose derived domain fails the hostname rule, writing nothing', async () => {
    for (const email of ['founder@localhost', 'founder@acme..com', 'founder@-acme.com', 'founder@10.0.0.1']) {
      state.writes = [];
      expect(await callback(email, { accountType: 'company' })).toBe(REJECTED);
      expect(state.writes).toEqual([]);
    }
  });

  it('rejects a platform-owner first login with an over-long email, writing nothing', async () => {
    const email = `${'a'.repeat(64)}@${hostnameOfLength(190)}`;
    expect(await callback(email, { owner: true })).toBe(REJECTED);
    expect(state.writes).toEqual([]);
  });

  it('logs a structured warning that never contains the email or its domain', async () => {
    const email = `${'z'.repeat(64)}@${hostnameOfLength(190)}`;
    await callback(email, { accountType: 'company' });

    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0] as [Record<string, unknown>, string];
    expect(fields).toMatchObject({ event: 'auth.signup.email_rejected', reason: 'email_too_long', emailLength: 255 });
    const serialized = JSON.stringify(warn.mock.calls[0]);
    expect(serialized).not.toContain('zzzz');
    expect(serialized).not.toContain('bbbb');
  });

  it('leaves the non-provisioning fall-through unchanged (no rejection, no write)', async () => {
    expect(await callback(`${'a'.repeat(64)}@${hostnameOfLength(190)}`)).toBe(`${ORIGIN}/logout`);
    expect(state.writes).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still provisions a normal company signup and names it from the email domain', async () => {
    expect(await callback('founder@acme.com', { accountType: 'company' })).toBe(`${ORIGIN}/dashboard`);
    expect(state.writes).toContain('organization.create');
  });
});

describe('checkSignupEmail', () => {
  it('classifies malformed and well-formed addresses', () => {
    expect(checkSignupEmail(`a@${hostnameOfLength(252)}`)).toEqual({ ok: true, domain: hostnameOfLength(252) });
    expect(checkSignupEmail(`@${hostnameOfLength(253)}`)).toEqual({ ok: false, reason: 'email_malformed' });
    expect(checkSignupEmail('founder@')).toEqual({ ok: false, reason: 'email_malformed' });
    expect(checkSignupEmail('no-at-sign')).toEqual({ ok: false, reason: 'email_malformed' });
    expect(checkSignupEmail('founder@acme.com')).toEqual({ ok: true, domain: 'acme.com' });
  });
});
