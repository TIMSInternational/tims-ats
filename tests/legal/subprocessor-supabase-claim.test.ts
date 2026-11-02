import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SUBPROCESSORS } from '../../apps/web/lib/legal/subprocessors';

// The subprocessor rows describe what the code SENDS to each vendor. The sign-in form passes the password the
// user typed to Supabase Auth (signInWithPassword), so the Supabase row must say Supabase receives the password,
// not only that it stores a hash of it (tier-1 review).

const supabase = SUBPROCESSORS.find((s) => s.id === 'supabase');
const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8');

describe('Supabase subprocessor row — credentials the code sends', () => {
  it('the sign-in form sends the entered password to Supabase Auth', () => {
    expect(read('apps/web/app/(auth)/login/page.tsx')).toMatch(/supabase\.auth\.signInWithPassword\(/);
  });

  it('says Supabase receives the password (and stores it hashed), in both locales', () => {
    expect(supabase).toBeDefined();
    expect(supabase!.dataCategories.en).toMatch(/the password, which Supabase receives over HTTPS/);
    expect(supabase!.dataCategories.en).toMatch(/stores only as a hash/);
    expect(supabase!.dataCategories.en).not.toMatch(/\(email, hashed password, sessions\)/);
    expect(supabase!.dataCategories.es).toMatch(/la contraseña, que Supabase recibe por HTTPS/);
    expect(supabase!.dataCategories.es).toMatch(/guarda solo como hash/);
    expect(supabase!.dataCategories.es).not.toMatch(/contraseña con hash, sesiones\)/);
  });
});
