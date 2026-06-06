import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = join(__dirname, '../..');

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
