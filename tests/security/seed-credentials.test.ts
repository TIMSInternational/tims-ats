import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// F15b: seed-users.ts created Supabase auth accounts with a password hardcoded in the repo, and
// defaulted to the PRODUCTION Supabase project when NEXT_PUBLIC_SUPABASE_URL was unset. The
// seeds now take the password from SEED_USER_PASSWORD (required, no default) and refuse to run
// without an explicit Supabase URL.

const ROOT = join(__dirname, '../..');
const SEED_USERS = join(ROOT, 'packages/db/prisma/seed-users.ts');
const FILES = [SEED_USERS, join(ROOT, 'packages/db/prisma/seed-demo.ts'), join(ROOT, '.claude/commands/mobile-qa.md')];
// Assembled so this file does not itself contain the retired literal.
const RETIRED_PASSWORD = ['TimsAts', '2026!'].join('');
const PROD_PROJECT_REF = ['lzhfnjfsdwdywwnlqgqq', 'supabase', 'co'].join('.');

function runSeedUsers(env: Record<string, string>) {
  // A sealed environment: nothing inherited, so the guard cannot be satisfied by the
  // developer's shell. No DATABASE_URL either — the guard must fire before any DB access.
  return spawnSync(process.execPath, ['--import', 'tsx', SEED_USERS], {
    cwd: join(ROOT, 'packages/db'),
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('seed credentials — no hardcoded password, no production default', () => {
  it.each(FILES)('%s does not contain the retired demo password', (file) => {
    expect(readFileSync(file, 'utf8')).not.toContain(RETIRED_PASSWORD);
  });

  it('seed-users.ts does not default to the production Supabase project', () => {
    expect(readFileSync(SEED_USERS, 'utf8')).not.toContain(PROD_PROJECT_REF);
  });

  it('refuses to run (exit 1) when NEXT_PUBLIC_SUPABASE_URL is unset', () => {
    const r = runSeedUsers({ SUPABASE_SERVICE_ROLE_KEY: 'x', SEED_USER_PASSWORD: 'long-enough-password' });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('NEXT_PUBLIC_SUPABASE_URL is not set');
    expect(r.stdout).not.toContain('Seeding test users');
  });

  it('refuses to run (exit 1) when SEED_USER_PASSWORD is unset or short, and never echoes it', () => {
    const unset = runSeedUsers({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'x' });
    expect(unset.status).toBe(1);
    expect(unset.stderr).toContain('SEED_USER_PASSWORD must be set');

    const short = runSeedUsers({
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'x',
      SEED_USER_PASSWORD: 'short-pw',
    });
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('SEED_USER_PASSWORD must be set');
    expect(short.stdout + short.stderr).not.toContain('short-pw');
  });
});
