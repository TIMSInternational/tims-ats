import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = join(__dirname, '../..');

function grepCodebase(pattern: string, paths: string[]): string[] {
  try {
    const result = execSync(
      `grep -rn "${pattern}" ${paths.join(' ')} --include="*.ts" --include="*.tsx" -l 2>/dev/null`,
      { cwd: ROOT, encoding: 'utf8' },
    );
    return result.trim().split('\n').filter(Boolean);
  } catch {
    return []; // grep returns exit 1 when no matches
  }
}

describe('XSS Prevention', () => {
  it('should NOT use dangerouslySetInnerHTML anywhere in web app', () => {
    const violations = grepCodebase('dangerouslySetInnerHTML', ['apps/web']);
    expect(violations).toEqual([]);
  });

  it('should NOT use innerHTML assignments in web app', () => {
    const violations = grepCodebase('\\.innerHTML\\s*=', ['apps/web']);
    expect(violations).toEqual([]);
  });

  it('should NOT use document.write in web app', () => {
    const violations = grepCodebase('document\\.write', ['apps/web']);
    expect(violations).toEqual([]);
  });
});
