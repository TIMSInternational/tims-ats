// The invitation page signs the invitee in on a separate, in-memory client so the browser's shared session is
// never written while requests are in flight (review round 3). Pins the options that make it isolated.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ createClient: vi.fn(), signInWithPassword: vi.fn(), shared: vi.fn() }));

vi.mock('@supabase/supabase-js', () => ({ createClient: state.createClient }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: state.shared }));

describe('invitationPasswordSignIn', () => {
  beforeEach(() => {
    vi.resetModules();
    state.createClient.mockReset();
    state.signInWithPassword.mockReset();
    state.shared.mockReset();
    state.createClient.mockReturnValue({ auth: { signInWithPassword: state.signInWithPassword } });
    state.signInWithPassword.mockResolvedValue({ data: { session: null }, error: null });
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it('signs in on a client that neither persists, refreshes nor reads the URL, and never the shared one', async () => {
    const { invitationPasswordSignIn } = await import('../../apps/web/app/accept-invitation/invitation-setup-api');
    await invitationPasswordSignIn({ email: 'invitee@example.test', password: 'secret-value' });
    expect(state.createClient).toHaveBeenCalledWith('https://supabase.example.test', 'anon-key', {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: 'tims-invitation-setup',
      },
    });
    expect(state.signInWithPassword).toHaveBeenCalledWith({ email: 'invitee@example.test', password: 'secret-value' });
    expect(state.shared).not.toHaveBeenCalled();
  });

  it('reuses one isolated client across attempts', async () => {
    const { invitationPasswordSignIn } = await import('../../apps/web/app/accept-invitation/invitation-setup-api');
    await invitationPasswordSignIn({ email: 'invitee@example.test', password: 'first' });
    await invitationPasswordSignIn({ email: 'invitee@example.test', password: 'second' });
    expect(state.createClient).toHaveBeenCalledOnce();
    expect(state.signInWithPassword).toHaveBeenCalledTimes(2);
  });

  it('fails loudly (the page shows its error) when Supabase is not configured', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { invitationPasswordSignIn } = await import('../../apps/web/app/accept-invitation/invitation-setup-api');
    expect(() => invitationPasswordSignIn({ email: 'invitee@example.test', password: 'x' })).toThrow();
    expect(state.createClient).not.toHaveBeenCalled();
  });
});
