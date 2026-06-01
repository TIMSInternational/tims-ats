import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
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

describe('Secrets & Credential Safety', () => {
  it('should NOT have hardcoded API keys or tokens in source', () => {
    const patterns = [
      'sk-[a-zA-Z0-9]{20,}',          // OpenAI/Stripe secret keys
      'sk_live_[a-zA-Z0-9]{20,}',     // Stripe live keys
      'AKIA[A-Z0-9]{16}',             // AWS access keys
      'eyJhbGciOiJ[a-zA-Z0-9._-]{50,}', // JWT tokens
    ];
    const violations: string[] = [];
    for (const pattern of patterns) {
      const found = grepCode(pattern, ['packages/', 'apps/web/']);
      // Exclude test files and .env.example
      const real = found.filter((f) => !f.includes('.test.') && !f.includes('.example') && !f.includes('node_modules'));
      violations.push(...real);
    }
    expect(violations).toEqual([]);
  });

  it('should NOT have hardcoded passwords in source', () => {
    const violations = grepCode('password\\s*[:=]\\s*["\'][^"\']*["\']', ['packages/', 'apps/web/lib/', 'apps/web/app/']);
    // Filter out type definitions and placeholder labels
    const real = violations.filter((f) =>
      !f.includes('node_modules') &&
      !f.includes('.test.') &&
      !f.includes('i18n') &&
      !f.includes('type') &&
      !f.includes('schema'),
    );
    expect(real).toEqual([]);
  });

  it('should have Zod env validation file', () => {
    expect(existsSync(join(ROOT, 'apps/web/lib/env.ts'))).toBe(true);
    const content = readFileSync(join(ROOT, 'apps/web/lib/env.ts'), 'utf8');
    expect(content).toContain('z.object');
    expect(content).toContain('NEXT_PUBLIC_SUPABASE_URL');
    expect(content).toContain('DATABASE_URL');
  });

  it('should NOT expose service_role key in client-side code', () => {
    const violations = grepCode('service_role', ['apps/web/app/', 'apps/web/components/', 'apps/web/lib/']);
    const real = violations.filter((f) => !f.includes('node_modules') && !f.includes('.test.'));
    expect(real).toEqual([]);
  });
});
