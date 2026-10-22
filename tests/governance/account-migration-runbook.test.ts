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
//    RUNBOOK_PRIVATE_DENYLIST=<path> (one token per line, `#` comments). Tokens are caught even when
//    embedded in a larger identifier (see containsDenied). Without the file the denylist check is skipped
//    (CI has no copy); the matcher's own synthetic tests and the shape checks below always run.
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

// Denylist matching. A denylisted name must be caught wherever it is EMBEDDED, not only as a standalone
// token: `<name>-alarms`, `<name>_bucket`, `user@<domain>`, `arn:...:<name>/x`, `<Name>Bucket`, or with the
// separators inside it changed (`foo-bar` written as `foo_bar`, `foo.bar`, `foo\-bar` or `FooBar`).
// So both sides are case-folded and stripped of every non-alphanumeric character, and the normalized
// token is searched for as a SUBSTRING of the normalized text. Substring matching on short tokens would
// false-positive (and joining adjacent words makes that worse), so a token whose normalized form is
// shorter than SUBSTRING_MIN instead matches on alphanumeric (and camelCase) boundaries, with any run of
// separators allowed where the token has one, which still catches `<tok>-x`, `x_<tok>`, `u@<tok>` and
// `my<Tok>Bucket`.
const SUBSTRING_MIN = 6;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Parses the private denylist. Throws (fails closed) on a line that normalizes to nothing. */
function parseDenylist(raw: string): string[] {
  const out: string[] = [];
  raw.split('\n').forEach((line, i) => {
    const t = line.trim().toLowerCase();
    if (!t || t.startsWith('#')) return;
    if (!normalize(t)) throw new Error(`denylist line ${i + 1} has no alphanumeric characters`);
    out.push(t);
  });
  return out;
}

/** True when `text` contains `token` anywhere, including embedded in a larger identifier. */
function containsDenied(text: string, token: string): boolean {
  const n = normalize(token);
  if (n.length >= SUBSTRING_MIN) return normalize(text).includes(n);
  const body = token
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join('[^a-z0-9]*');
  const split = text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return new RegExp(`(?<![a-z0-9])${body}(?![a-z0-9])`).test(split);
}

/** How many denylist entries `text` contains. A count only, never the tokens themselves. */
function deniedHits(text: string, deny: readonly string[]): number {
  return deny.filter((t) => containsDenied(text, t)).length;
}

/** Compound identifiers a real leak would take; every one must be caught for every token. */
function compoundVariants(token: string): string[] {
  const camel = token.charAt(0).toUpperCase() + token.slice(1);
  return [
    `see ${token} here`,
    `${token}-alarms`,
    `${token}_bucket`,
    `prod.${token}.internal`,
    `ops@${token}`,
    `user@${token}.example`,
    `arn:aws:s3:::${token}/key`,
    `\`${token.toUpperCase()}\``,
    `my${camel}Bucket`,
    token.replace(/[^a-z0-9]/g, '_'),
    token.replace(/[^a-z0-9]/g, ''),
    token.replace(/[^a-z0-9]/g, '\\$&'),
  ];
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
    const deny = parseDenylist(readFileSync(path, 'utf8'));
    expect(deny.length, 'private denylist is empty').toBeGreaterThan(0);
    // The matcher must catch every REAL token in compound form, or a pass below means nothing.
    const missed = deny.filter((t) => compoundVariants(t).some((v) => !containsDenied(v, t))).length;
    expect(missed, `matcher misses compound forms of ${missed} denylisted token(s)`).toBe(0);
    for (const [name, text] of [
      ['runbook', doc()],
      ['this test', readFileSync(SELF, 'utf8')],
    ] as const) {
      const hits = deniedHits(text, deny);
      // Report a count only, never the tokens, so a failure cannot leak them into (public) CI logs.
      expect(hits, `${name} re-discloses ${hits} privately denylisted token(s)`).toBe(0);
    }
  });

  it('denylist matcher catches tokens embedded in identifiers (synthetic tokens, always runs)', () => {
    // Synthetic stand-ins only: real tokens never appear in this public file.
    for (const tok of ['zqxacmewidgets', 'zqx-acme.example', 'zqxa', 'zq-x']) {
      for (const v of compoundVariants(tok)) {
        expect(containsDenied(v, tok), `missed a compound form of synthetic token "${tok}": ${v}`).toBe(true);
      }
    }
    // Short tokens match on boundaries only, so they do not fire inside unrelated words.
    expect(containsDenied('a zqxab b', 'zqxa')).toBe(false);
    expect(containsDenied('zqxa-alarms', 'zqxa')).toBe(true);
    expect(deniedHits('nothing to see here', ['zqxacmewidgets', 'zqxa'])).toBe(0);
    expect(() => parseDenylist('# c\n\n---\n')).toThrow(/no alphanumeric/);
    expect(parseDenylist('# c\n Foo-Bar \n\n')).toEqual(['foo-bar']);
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

// Tier-1 (Codex) review, 2026-10-22: claims the runbook must make so the rebuild does not fail late.
describe('account migration runbook: tier-1 review claims', () => {
  it('flags App Runner closure to new customers as a blocking decision before Phase E', () => {
    const text = doc();
    expect(text).toMatch(/App Runner is closed to new customers/);
    expect(text).not.toMatch(/AWS has announced no change/);
  });

  it('populates secrets before the service is created (or redeploys before smoke)', () => {
    expect(doc()).toMatch(/Secrets first, then the service/);
    expect(doc()).toMatch(/apprunner start-deployment/);
  });

  it('covers the TypeScript sender variable and the TS identity grants', () => {
    const text = doc();
    expect(text).toMatch(/PLATFORM_EMAIL_FROM/);
    expect(text).toMatch(/ses:SendEmail/);
    expect(text).toMatch(/s3:PutObject` \+ `s3:GetObject/);
  });

  it('round 2: no rotation before the rollback window closes; real job flags; raw email grant', () => {
    const text = doc();
    expect(text).not.toMatch(/\*\*rotate while moving\*\*/i);
    expect(text).toMatch(/AFTER blue is paused and the step 10 rollback window has closed/);
    expect(text).toMatch(/It does NOT turn scheduling off/);
    expect(text).toMatch(/Platform__FxRefreshEnabled/);
    expect(text).toMatch(/ses:SendEmail` and `ses:SendRawEmail/);
    expect(text).toMatch(/interview invitation arrives with its `\.ics` attachment/);
    // Round 3: a skipped (deploy=false) run is not CD verification.
    expect(text).not.toMatch(/Run a no-op deploy/);
    expect(text).toMatch(/Prove CD with a REAL deployment/);
  });
});

