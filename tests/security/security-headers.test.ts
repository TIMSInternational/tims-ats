import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

describe('Security Headers & Configuration', () => {
  it('should have security headers in next.config', () => {
    const configPath = join(ROOT, 'apps/web/next.config.ts');
    if (!existsSync(configPath)) return; // Skip if using .js
    const content = readFileSync(configPath, 'utf8');
    expect(content).toContain('headers');
  });

  it('should have ESLint configuration', () => {
    expect(existsSync(join(ROOT, '.eslintrc.json'))).toBe(true);
    const content = readFileSync(join(ROOT, '.eslintrc.json'), 'utf8');
    expect(content).toContain('typescript-eslint');
  });

  it('should have Prettier configuration', () => {
    expect(existsSync(join(ROOT, '.prettierrc'))).toBe(true);
  });

  it('should have CORS configured in next.config (not wildcard)', () => {
    const configPath = join(ROOT, 'apps/web/next.config.ts');
    if (!existsSync(configPath)) return;
    const content = readFileSync(configPath, 'utf8');
    // Should NOT have Access-Control-Allow-Origin: *
    expect(content).not.toContain("'*'");
  });

  it('should NOT disable TLS verification anywhere', () => {
    const files = [
      'packages/api/src/lib/ses.ts',
      'packages/api/src/trpc.ts',
    ];
    for (const file of files) {
      const fullPath = join(ROOT, file);
      if (!existsSync(fullPath)) continue;
      const content = readFileSync(fullPath, 'utf8');
      expect(content).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
      expect(content).not.toContain('rejectUnauthorized: false');
    }
  });
});
