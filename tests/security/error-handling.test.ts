import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
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

describe('Error Handling & Information Leakage', () => {
  it('should NOT return err.message directly to clients in API responses', () => {
    // API routers should use TRPCError with fixed messages, not raw err.message
    const violations = grepCode('catch.*err.*\\.message', ['packages/api/src/routers/']);
    // Filter: some catch blocks rethrow as TRPCError which is fine
    // We're looking for patterns like: res.json({ error: err.message })
    const dangerous = violations.filter((f) => {
      const content = readFileSync(join(ROOT, f), 'utf8');
      return content.includes('err.message') && !content.includes('TRPCError');
    });
    expect(dangerous).toEqual([]);
  });

  it('should NOT use console.log in production API code', () => {
    const violations = grepCode('console\\.log', ['packages/api/src/routers/']);
    expect(violations).toEqual([]);
  });

  it('should NOT log request bodies or sensitive data', () => {
    const violations = grepCode('console\\.log.*req\\.body\\|console\\.log.*password\\|console\\.log.*token\\|console\\.log.*secret', [
      'packages/api/src/',
    ]);
    expect(violations).toEqual([]);
  });

  it('should have error toasts on all frontend mutations', () => {
    // Check that platform pages import toast
    const violations: string[] = [];
    const platformPages = [
      'apps/web/app/(admin)/platform/invoices/page.tsx',
      'apps/web/app/(admin)/platform/invitations/page.tsx',
      'apps/web/app/(admin)/platform/organizations/page.tsx',
    ];
    for (const page of platformPages) {
      try {
        const content = readFileSync(join(ROOT, page), 'utf8');
        if (content.includes('useMutation') && !content.includes('toast')) {
          violations.push(page);
        }
      } catch {
        // File may not exist
      }
    }
    expect(violations).toEqual([]);
  });
});
