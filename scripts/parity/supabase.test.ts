import { describe, it, expect, vi } from 'vitest';
import { getTokenWith, type SignIn } from './supabase';

describe('getTokenWith', () => {
  it('calls signIn once per email then serves cache', async () => {
    const signIn: SignIn = vi.fn(async (e) => `tok-${e}`);
    const cache = new Map<string, string>();
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
