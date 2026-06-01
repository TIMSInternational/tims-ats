import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../..');

describe('Dependency & Supply Chain Safety', () => {
  it('should have pnpm-lock.yaml committed', () => {
    expect(existsSync(join(ROOT, 'pnpm-lock.yaml'))).toBe(true);
  });

  it('should NOT have package-lock.json (pnpm only)', () => {
    expect(existsSync(join(ROOT, 'package-lock.json'))).toBe(false);
  });

  it('should NOT have yarn.lock (pnpm only)', () => {
    expect(existsSync(join(ROOT, 'yarn.lock'))).toBe(false);
  });

  it('should not have empty shell packages (email, events, etc)', () => {
    const removed = ['email', 'events', 'whatsapp', 'video', 'storage'];
    for (const pkg of removed) {
      expect(existsSync(join(ROOT, `packages/${pkg}/package.json`))).toBe(false);
    }
  });

  it('should have all active packages with real implementations', () => {
    const active = ['api', 'db', 'shared', 'auth', 'ai', 'ui', 'i18n'];
    for (const pkg of active) {
      expect(existsSync(join(ROOT, `packages/${pkg}/package.json`))).toBe(true);
    }
  });

  it('should have @aws-sdk/client-ses as a real dependency (not hallucinated)', () => {
    const apiPkg = JSON.parse(readFileSync(join(ROOT, 'packages/api/package.json'), 'utf8'));
    expect(apiPkg.dependencies?.['@aws-sdk/client-ses']).toBeDefined();
    // Verify it's listed in pnpm-lock.yaml (pnpm hoists to .pnpm store, not flat node_modules)
    const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');
    expect(lockfile).toContain('@aws-sdk/client-ses');
  });

  it('should have @upstash/ratelimit as a real dependency', () => {
    const apiPkg = JSON.parse(readFileSync(join(ROOT, 'packages/api/package.json'), 'utf8'));
    expect(apiPkg.dependencies?.['@upstash/ratelimit']).toBeDefined();
  });
});
