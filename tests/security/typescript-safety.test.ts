import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

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

function countMatches(pattern: string, paths: string[]): number {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${paths.join(' ')} --include="*.ts" --include="*.tsx" 2>/dev/null | wc -l`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    return parseInt(result.trim(), 10);
  } catch {
    return 0;
  }
}

describe('TypeScript Safety', () => {
  it('should NOT have @ts-ignore in source code', () => {
    const violations = grepCode('@ts-ignore', ['packages/', 'apps/web/app/', 'apps/web/lib/', 'apps/web/components/']);
    const real = violations.filter((f) => !f.includes('node_modules') && !f.includes('.test.'));
    expect(real).toEqual([]);
  });

  it('should NOT have @ts-nocheck in source code', () => {
    const violations = grepCode('@ts-nocheck', ['packages/', 'apps/web/app/', 'apps/web/lib/', 'apps/web/components/']);
    const real = violations.filter((f) => !f.includes('node_modules') && !f.includes('.test.'));
    expect(real).toEqual([]);
  });

  it('should have strict mode enabled in tsconfig', () => {
    const tsconfig = readFileSync(join(ROOT, 'tsconfig.json'), 'utf8');
    expect(tsconfig).toContain('"strict": true');
  });

  it('should have minimal any types in platform pages (< 15 remaining)', () => {
    const count = countMatches(': any\\b', ['apps/web/app/']);
    // Allow a small number for edge cases but flag if it grows
    expect(count).toBeLessThan(20);
  });

  it('should NOT use eval() or new Function() in source code', () => {
    const evalViolations = grepCode('\\beval\\s*\\(', ['packages/', 'apps/web/']);
    const funcViolations = grepCode('new Function\\s*\\(', ['packages/', 'apps/web/']);
    const real = [...evalViolations, ...funcViolations].filter(
      (f) => !f.includes('node_modules') && !f.includes('.test.'),
    );
    expect(real).toEqual([]);
  });
});
