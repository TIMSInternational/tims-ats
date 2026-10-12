import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Guards docs/plans/2026-10-12-account-migration-runbook.md.
//
// 1. DISCLOSURE. This repository is PUBLIC. The runbook was first written with the full read-only
//    inventory of a NexaDev-owned AWS account, Vercel team and Supabase org, which named NexaDev's
//    other clients, personal domains, IAM users holding static keys, and internal IDs. Some of those
//    names were ALREADY public before this runbook (e.g. other products sharing the account are named
//    in scripts/deploy/bootstrap-github-oidc-role.sh and services/Tims.Platform/deploy/terraform/
//    README.md); the runbook withholds them anyway so it does not add to or consolidate that exposure.
//
//    The denylist itself is NOT in this repo, in any form. An earlier version committed unsalted
//    SHA-256 hashes of the tokens; those are a confirmation oracle for short guessable names, so they
//    re-disclosed what they guarded. The plaintext list lives outside the repo and is supplied with
//    RUNBOOK_PRIVATE_DENYLIST=<path> (one lowercase token per line, `#` comments). Without it the
//    denylist check is skipped (CI has no copy); the shape checks below always run.
// 2. CLAIMS. Each remaining check pins a statement the runbook must make because the code it describes
//    would otherwise make the step fail (review findings, fix round 1).

const ROOT = join(__dirname, '..', '..');
const RUNBOOK = join(ROOT, 'docs/plans/2026-10-12-account-migration-runbook.md');
const BOOTSTRAP = join(ROOT, 'scripts/deploy/bootstrap-github-oidc-role.sh');
const SELF = join(ROOT, 'tests/governance/account-migration-runbook.test.ts');
const DENYLIST_PATH = process.env.RUNBOOK_PRIVATE_DENYLIST;

// The one Supabase project ref that may appear (TIMS ATS's own, already in the repo).
const ALLOWED_SUPABASE_REF = 'lzhfnjfsdwdywwnlqgqq';

function doc(): string {
  expect(existsSync(RUNBOOK), 'The account migration runbook is GONE.').toBe(true);
  return readFileSync(RUNBOOK, 'utf8');
}

/** Every token, plus each dot/hyphen-trimmed variant, so `x.com`, `x.com.` and `` `x` `` all match. */
function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9._@/-]+/)) {
    for (const part of raw.split('/')) {
      const t = part.replace(/^[.\-_@]+|[.\-_@]+$/g, '');
      if (t.length >= 4) out.add(t);
    }
  }
  return out;
}

/** Asserts on a boolean so a failure never dumps the whole runbook into (public) CI logs. */
function expectMatch(text: string, want: boolean, msg: string | undefined, re: RegExp): void {
  expect(re.test(text), msg ?? `runbook ${want ? 'must' : 'must not'} match ${re}`).toBe(want);
}

describe('Account migration runbook — public-repo disclosure', () => {
  it('commits no hash or digest that could act as a confirmation oracle for redacted tokens', () => {
    // A 64-hex (SHA-256) or 40-hex (SHA-1) literal in either file is how the denylist leaked before.
    for (const [name, text] of [
      ['runbook', doc()],
      ['this test', readFileSync(SELF, 'utf8')],
    ] as const) {
      expect(/\b[0-9a-f]{64}\b/.test(text), `${name} must not contain a SHA-256 literal`).toBe(false);
      expect(/\b[0-9a-f]{40}\b/.test(text), `${name} must not contain a SHA-1 literal`).toBe(false);
    }
  });

  it.skipIf(!DENYLIST_PATH)('names no privately denylisted token (needs RUNBOOK_PRIVATE_DENYLIST)', () => {
    const path = DENYLIST_PATH as string;
    // Fail closed: a set-but-wrong path must not silently pass.
    expect(existsSync(path), 'RUNBOOK_PRIVATE_DENYLIST is set but the file does not exist').toBe(true);
    const deny = new Set(
      readFileSync(path, 'utf8')
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l && !l.startsWith('#')),
    );
    expect(deny.size, 'private denylist is empty').toBeGreaterThan(0);
    for (const [name, text] of [
      ['runbook', doc()],
      ['this test', readFileSync(SELF, 'utf8')],
    ] as const) {
      const hits = [...tokens(text)].filter((t) => deny.has(t)).length;
      // Report a count only, never the tokens, so a failure cannot leak them into (public) CI logs.
      expect(hits, `${name} re-discloses ${hits} privately denylisted token(s)`).toBe(0);
    }
  });

  it('does not overstate the redaction: names the files that already disclosed other products', () => {
    const text = doc();
    const head = text.slice(0, text.indexOf('\n## '));
    for (const f of [
      'scripts/deploy/bootstrap-github-oidc-role.sh',
      'services/Tims.Platform/deploy/terraform/README.md',
    ]) {
      expect(head.includes(f), `redaction note must say ${f} already names other products`).toBe(true);
    }
    expectMatch(head, true, undefined, /already public before this runbook/);
  });

  it('contains no Vercel project/team IDs and no Supabase ref other than TIMS ATS', () => {
    const text = doc();
    expectMatch(text, false, undefined, /\bprj_[A-Za-z0-9]{10,}/);
    expectMatch(text, false, undefined, /\bteam_[A-Za-z0-9]{10,}/);
    const refs = [...new Set(text.match(/\b[a-z]{20}\b/g) ?? [])].filter((r) => r !== ALLOWED_SUPABASE_REF);
    expect(refs.length, 'Unexpected 20-letter (Supabase-ref-shaped) tokens in runbook (count shown)').toBe(0);
  });
});

describe('Account migration runbook — claims that the code makes true', () => {
  it('does not treat the OIDC bootstrap script as account-parameterizable alone while it hardcodes the service and role', () => {
    const script = readFileSync(BOOTSTRAP, 'utf8');
    const text = doc();
    if (/SERVICE_ARN="[^"]*service\/tims-platform-api\/[0-9a-f]{32}"/.test(script)) {
      expectMatch(text, true, 'runbook must call out the hardcoded per-service SERVICE_ARN suffix', /SERVICE_ARN/);
    }
    if (/ECR_ACCESS_ROLE="[^"]*-ecr-access-role"/.test(script)) {
      expectMatch(text, true, 'runbook must call out the hardcoded ECR_ACCESS_ROLE name', /ECR_ACCESS_ROLE/);
    }
    if (/OIDC provider not found\. Expected it to already exist/.test(script)) {
      expectMatch(
        text,
        true,
        'runbook must create the OIDC provider in the new account',
        /create-open-id-connect-provider|aws_iam_openid_connect_provider/,
      );
    }
  });

  it('lists every governance test that pins the account literal in script output, not only rollback-workflow', () => {
    const text = doc();
    for (const f of ['rollback-workflow.test.ts', 'github-oidc-trust.test.ts', 'ops-alarms.test.ts']) {
      expect(text.includes(f), `runbook must name ${f} as changing with the parameterization`).toBe(true);
    }
    expectMatch(text, false, undefined, /Fixtures can stay literal\./);
  });

  it('makes transfer-back rollbacks require an Owner of the org/team the project now sits in', () => {
    const text = doc();
    expectMatch(text, false, undefined, /Federico remains a member of the TIMS team/);
    expectMatch(text, false, undefined, /Federico stays an Owner of the source NexaDev org/);
    expectMatch(text, true, undefined, /Owner of the TIMS Vercel team/);
    expectMatch(text, true, undefined, /Owner of the TIMS Supabase org/);
  });

  it('re-points the SMTP key consumer (Supabase Auth custom SMTP) before decommissioning the old account', () => {
    const text = doc();
    expectMatch(text, true, undefined, /Supabase Auth[^\n]*SMTP/);
    expectMatch(text, true, undefined, /before step 11/i);
  });
});
