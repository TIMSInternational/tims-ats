import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = join(__dirname, '../..');

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function grepCode(pattern: string, paths: string[]): string[] {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${paths.join(' ')} --include="*.ts" --include="*.tsx" -l 2>/dev/null`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

describe('PII Protection', () => {
  it('should NOT log user input or PII in API code', () => {
    const violations = grepCode(
      'console\\.log.*email\\|console\\.log.*password\\|console\\.log.*ssn\\|console\\.log.*salary',
      ['packages/api/src/'],
    );
    expect(violations).toEqual([]);
  });

  it('should NOT log PII through the pino logger either', () => {
    // The assertion above only greps `console.log`. This codebase does not log that way —
    // it logs through pino (`logger.warn/error/info` from @tims/shared), so CLAUDE.md's
    // "no console.log with PII" ban was unenforceable against the idiom actually in use.
    // Found while fixing the DSAR §21 audit gap: `data-requests.ts` was spreading the data
    // subject's plaintext email into a `logger.warn` payload, four lines from the audit
    // code, and no test objected.
    //
    // ⚠️ KNOWN LIMIT, stated rather than implied: this catches a LITERAL key
    // (`{ email }`, `{ email: x }`). It does NOT catch a spread — `{ ...auditMeta }`,
    // which is exactly how the DSAR leak was actually written. Verified by mutation:
    // restoring the real `...auditMeta` spread leaves this green. Resolving a spread
    // needs type information, not a source scan. So this control raises the floor
    // (the obvious spelling can no longer land) without closing the class, and the
    // review checklist still has to catch a spread of an object holding PII.
    //
    // Deliberately narrow on the key list too: a pattern this cannot express precisely
    // is worse than no control, because a check that cries wolf gets switched off.
    //
    // Scanned ACROSS LINES, not with grep. `grepCode` is line-based, and Prettier puts the
    // payload object on its own line:
    //     logger.warn(
    //       { action: 'x', email, matched },
    //       'message',
    //     );
    // A line-anchored pattern sees `logger.warn(` and the payload separately and matches
    // neither — verified by mutation: the line-based version stayed green against a
    // deliberately reintroduced `email` key.
    const violations: string[] = [];
    for (const file of tsFilesUnder(join(ROOT, 'packages/api/src'))) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/logger\s*\.\s*(?:warn|error|info|debug)\s*\(\s*\{([^}]*)\}/gs)) {
        if (/(?:^|[,{\s])(email|ssn|salary|password)\s*[,:}]/.test(m[1])) {
          violations.push(`${file.replace(ROOT + '/', '')}: ${m[1].trim().slice(0, 60)}`);
        }
      }
    }
    expect(
      violations,
      'A pino logger call puts PII (email/ssn/salary/password) in its payload. Log an id or a count ' +
        'instead — the subject is recoverable from the audit tables, which have different retention and ' +
        'access controls than the log sink.',
    ).toEqual([]);
  });

  it('should have SES email utility that does not log email content', () => {
    const sesFile = join(ROOT, 'packages/api/src/lib/ses.ts');
    expect(existsSync(sesFile)).toBe(true);
    const content = readFileSync(sesFile, 'utf8');
    // Should log failure but not email content
    expect(content).not.toContain('console.log(html');
    expect(content).not.toContain('console.log(subject');
    expect(content).not.toContain('console.log(to');
  });

  it('should document PII handling architecture', () => {
    // PII doctrine lives in .claude/rules/ai-safety.md since the CLAUDE.md
    // re-org (2026-06-06); CLAUDE.md core still bans PII in logs.
    const aiSafety = readFileSync(join(ROOT, '.claude/rules/ai-safety.md'), 'utf8');
    expect(aiSafety).toContain('PII');
    expect(aiSafety).toContain('Presidio');
    expect(aiSafety).toContain('tokenize');
    const claudeMd = readFileSync(join(ROOT, 'CLAUDE.md'), 'utf8');
    expect(claudeMd).toContain('PII');
  });

  it('should have AI architecture doc with PII proxy design', () => {
    const aiDoc = join(ROOT, 'docs/AI-AGENT-ARCHITECTURE.md');
    expect(existsSync(aiDoc)).toBe(true);
    const content = readFileSync(aiDoc, 'utf8');
    expect(content).toContain('PII');
    expect(content).toContain('vault');
    expect(content).toContain('Presidio');
  });
});
