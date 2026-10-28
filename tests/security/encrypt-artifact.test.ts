/**
 * scripts/security/encrypt-artifact.sh (#336 tier-1 round 5): the schema re-capture artifact of a PUBLIC repo is
 * uploaded only as ciphertext for the owner's age key. These run against a stub `age` on a minimal PATH, so they
 * prove the script's contract — refuse without a well-formed recipient or the binary, never emit plaintext,
 * leave nothing behind on failure — without needing age installed. The real age CLI round-trip was exercised by
 * hand (see the PR body); the workflow installs age and runs `--check` before touching production.
 */
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'scripts/security/encrypt-artifact.sh');
const RECIPIENT = `age1${'qpzry9x8gf2tvdw0s3jn54khce6mua7l'.repeat(2).slice(0, 58)}`;
const PLAINTEXT_MARKER = 'SYNTHETIC_PLAINTEXT_MARKER_7731';

let sandbox: string;

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'encrypt-artifact-'));
});
afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A bin dir holding only the tools the script needs, plus (optionally) a stub `age`. */
function binDir(name: string, age: 'encrypting' | 'passthrough' | 'failing' | null): string {
  const bin = join(sandbox, name, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const tool of [
    'bash',
    'tar',
    'gzip',
    'mktemp',
    'rm',
    'mkdir',
    'mv',
    'head',
    'basename',
    'ls',
    'cat',
    'dirname',
  ]) {
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
    if (found) symlinkSync(found, join(bin, tool));
  }
  if (age) {
    const out = '"$4"'; // invoked as: age -r RECIPIENT -o OUT IN
    const body =
      age === 'encrypting'
        ? `printf '%s\\n' "$@" > "${join(sandbox, name)}/argv"\n{ printf 'age-encryption.org/v1\\n'; base64 < "$5"; } > ${out}\n`
        : age === 'passthrough'
          ? `cat "$5" > ${out}\n`
          : 'echo "age: error: boom" >&2\nexit 1\n';
    writeFileSync(join(bin, 'age'), `#!/usr/bin/env bash\n${body}`);
    chmodSync(join(bin, 'age'), 0o755);
    const b64 = spawnSync('bash', ['-c', 'command -v base64'], { encoding: 'utf8' }).stdout.trim();
    if (b64) symlinkSync(b64, join(bin, 'base64'));
  }
  return bin;
}

function source(name: string): string {
  const src = join(sandbox, name, 'schema-baseline-recapture');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'capture-summary.txt'), `~ TABLE public.t\n${PLAINTEXT_MARKER}\n`);
  return src;
}

function run(bin: string, args: string[], recipient: string | undefined) {
  const r = spawnSync(join(bin, 'bash'), [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: bin, NODE_ENV: process.env.NODE_ENV ?? 'test', ...(recipient === undefined ? {} : { AGE_RECIPIENT: recipient }) },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('encrypt-artifact.sh — only ciphertext for the owner key, or nothing', () => {
  it('--check refuses an absent recipient', () => {
    const r = run(binDir('check-none', 'encrypting'), ['--check'], undefined);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/AGE_RECIPIENT is empty/);
  });

  it('--check refuses anything that is not an X25519 age recipient', () => {
    const bin = binDir('check-bad', 'encrypting');
    for (const bad of [
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample',
      `${RECIPIENT}x`,
      RECIPIENT.toUpperCase(),
      `${RECIPIENT.slice(0, -1)}b`, // b is not bech32
      `${RECIPIENT} -r age1attacker`,
    ]) {
      const r = run(bin, ['--check'], bad);
      expect(r.code, bad).toBe(2);
      expect(r.out).toMatch(/not an age X25519 public key/);
    }
  });

  it('--check refuses when the age binary is missing', () => {
    const r = run(binDir('check-noage', null), ['--check'], RECIPIENT);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/age binary is not installed/);
  });

  it('--check passes with a recipient and the binary', () => {
    const r = run(binDir('check-ok', 'encrypting'), ['--check'], RECIPIENT);
    expect(r.code, r.out).toBe(0);
  });

  it('encrypts to the recipient: OUT holds exactly the .age file and DECRYPT.txt, no plaintext', () => {
    const bin = binDir('ok', 'encrypting');
    const out = join(sandbox, 'ok', 'encrypted');
    const r = run(bin, [source('ok'), out], RECIPIENT);
    expect(r.code, r.out).toBe(0);
    expect(readdirSync(out).sort()).toEqual(['DECRYPT.txt', 'schema-baseline-recapture.tar.gz.age']);
    const argv = readFileSync(join(sandbox, 'ok', 'argv'), 'utf8').split('\n');
    expect(argv.slice(0, 2)).toEqual(['-r', RECIPIENT]);
    for (const f of readdirSync(out)) expect(readFileSync(join(out, f), 'utf8')).not.toContain(PLAINTEXT_MARKER);
    expect(readFileSync(join(out, 'schema-baseline-recapture.tar.gz.age'), 'utf8')).toMatch(
      /^age-encryption\.org\/v1\n/,
    );
  });

  it('refuses output that is not age-formatted (a passthrough) and writes nothing', () => {
    const out = join(sandbox, 'pass', 'encrypted');
    const r = run(binDir('pass', 'passthrough'), [source('pass'), out], RECIPIENT);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/no age-format output/);
    expect(existsSync(out)).toBe(false);
  });

  it('a failing age writes nothing', () => {
    const out = join(sandbox, 'fail', 'encrypted');
    const r = run(binDir('fail', 'failing'), [source('fail'), out], RECIPIENT);
    expect(r.code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a non-empty output directory (no plaintext can ride along)', () => {
    const out = join(sandbox, 'nonempty', 'encrypted');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'leftover.txt'), PLAINTEXT_MARKER);
    const r = run(binDir('nonempty', 'encrypting'), [source('nonempty'), out], RECIPIENT);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/not empty/);
  });

  it('without a recipient, encryption refuses before reading the source', () => {
    const out = join(sandbox, 'norecip', 'encrypted');
    const r = run(binDir('norecip', 'encrypting'), [source('norecip'), out], '');
    expect(r.code).toBe(2);
    expect(existsSync(out)).toBe(false);
  });
});
