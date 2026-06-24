import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const ROUTERS_DIR = join(__dirname, '../../packages/api/src/routers');
const TRPC_FILE = join(__dirname, '../../packages/api/src/trpc.ts');

function getRouterFiles(): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(ROUTERS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(join(ROUTERS_DIR, entry.name));
    } else if (entry.isDirectory()) {
      const subDir = join(ROUTERS_DIR, entry.name);
      for (const sub of readdirSync(subDir)) {
        if (sub.endsWith('.ts')) files.push(join(subDir, sub));
      }
    }
  }
  return files;
}

describe('Authentication & Authorization', () => {
  it('should have auth middleware defined in trpc.ts', () => {
    const content = readFileSync(TRPC_FILE, 'utf8');
    expect(content).toContain('isAuthed');
    expect(content).toContain('protectedProcedure');
  });

  it('should limit publicProcedure usage to known safe endpoints', () => {
    const allowedPublicEndpoints = [
      'getInvitationByToken',
      'acceptInvitation',
      // Portal endpoints — public-facing candidate portal (unauthenticated job browsing)
      'getPortalStats',
      'listVacancies',
      'getVacancy',
      'applyToVacancy',
      // Offer signing — candidate accesses an offer via an emailed signing token (no account)
      'getBySigningToken',
      'acceptByToken',
      'declineByToken',
      // AI voice interview — candidate accesses session via a magic-link candidateToken (no account)
      'recordConsent',
      'start',
    ];
    const violations: string[] = [];

    for (const file of getRouterFiles()) {
      const content = readFileSync(file, 'utf8');
      const matches = content.matchAll(/(\w+):\s*publicProcedure/g);
      for (const match of matches) {
        const name = match[1];
        if (!allowedPublicEndpoints.includes(name)) {
          violations.push(`${file.split('/').pop()}:${name}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('should have permission middleware for sensitive operations', () => {
    const content = readFileSync(TRPC_FILE, 'utf8');
    expect(content).toContain('requirePermission');
    expect(content).toContain('permissionProcedure');
  });

  it('withTenantContext routes org-bearing platform owners through runWithTenant (RLS GUC set)', () => {
    const content = readFileSync(TRPC_FILE, 'utf8');
    // The platform-owner branch must NOT be an unconditional early return — an
    // org-bearing owner has to flow into the same runWithTenant path as staff,
    // otherwise tenantDb runs with the ALS empty → unscoped (BYPASSRLS login role).
    expect(content).not.toMatch(/if \(ctx\.user\?\.isPlatformOwner\) \{\s*return next\(\);\s*\}/);
    expect(content).toMatch(/isPlatformOwner[\s\S]*?ownOrg[\s\S]*?runWithTenant/);
  });

  it('should verify organizationId in user mutation WHERE clauses', () => {
    const userRouter = readFileSync(join(ROUTERS_DIR, 'user.ts'), 'utf8');
    // The deactivate mutation must check organizationId
    const deactivateSection = userRouter.slice(
      userRouter.indexOf('deactivate:'),
      userRouter.indexOf('deactivate:') + 500,
    );
    expect(deactivateSection).toContain('organizationId');
  });

  it('should have platform owner guard on platform routes', () => {
    const commonFile = readFileSync(join(ROUTERS_DIR, 'platform', '_common.ts'), 'utf8');
    expect(commonFile).toContain('isPlatformOwner');
    expect(commonFile).toContain('platformProcedure');
  });

  it('should validate invitation tokens as UUID format', () => {
    const invitationsFile = readFileSync(join(ROUTERS_DIR, 'platform', 'invitations.ts'), 'utf8');
    // Both getInvitationByToken and acceptInvitation should validate token as UUID
    const tokenValidations = invitationsFile.match(/token:\s*z\.string\(\)\.uuid\(\)/g);
    expect(tokenValidations?.length).toBeGreaterThanOrEqual(2);
  });
});
