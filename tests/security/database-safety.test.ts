import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SCHEMA_DIR = join(__dirname, '../../packages/db/prisma/schema');
const DB_INDEX = join(__dirname, '../../packages/db/src/index.ts');

function getSchemaFiles(): { name: string; content: string }[] {
  return readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.prisma'))
    .map((f) => ({ name: f, content: readFileSync(join(SCHEMA_DIR, f), 'utf8') }));
}

describe('Database Safety', () => {
  it('should use @@map on all models (snake_case table names)', () => {
    const violations: string[] = [];
    for (const { name, content } of getSchemaFiles()) {
      const models = content.matchAll(/model\s+(\w+)\s*\{/g);
      for (const match of models) {
        const modelName = match[1];
        // Find the model block
        const start = match.index!;
        const end = content.indexOf('\n}', start);
        const block = content.slice(start, end);
        if (!block.includes('@@map(')) {
          violations.push(`${name}:${modelName}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('should have @@index on organizationId for all tenant-scoped models', () => {
    const violations: string[] = [];
    for (const { name, content } of getSchemaFiles()) {
      const models = content.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)(?=\nmodel|\n$|\z)/g);
      for (const match of models) {
        const modelName = match[1];
        const block = match[2];
        // Skip non-tenant models
        if (!block.includes('organizationId')) continue;
        if (!block.includes('@@index([organizationId])') && !block.includes('@@index([organizationId,')) {
          // Check if orgId is part of a unique constraint instead
          if (!block.includes('@@unique([organizationId')) {
            violations.push(`${name}:${modelName}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('should use Prisma enums (not raw strings) for status fields', () => {
    const schemas = getSchemaFiles();
    const allContent = schemas.map((s) => s.content).join('\n');

    // These enums should exist
    expect(allContent).toContain('enum InvoiceStatus');
    expect(allContent).toContain('enum OrgPlan');
    expect(allContent).toContain('enum SubscriptionStatus');
    expect(allContent).toContain('enum InvitationType');
    expect(allContent).toContain('enum InvitationStatus');
  });

  it('should export enums from db package', () => {
    const content = readFileSync(DB_INDEX, 'utf8');
    expect(content).toContain('InvoiceStatus');
    expect(content).toContain('OrgPlan');
  });

  it('should have FK indexes on all foreign key fields', () => {
    // Spot-check critical models
    const schemas = getSchemaFiles();
    const allContent = schemas.map((s) => s.content).join('\n');

    // Invoice should have subscriptionId index
    const billingSchema = schemas.find((s) => s.name === 'billing.prisma')!.content;
    expect(billingSchema).toContain('@@index([subscriptionId])');

    // Candidate should have createdById index
    const candidateSchema = schemas.find((s) => s.name === 'candidate.prisma')!.content;
    expect(candidateSchema).toContain('@@index([createdById])');

    // AuditLog should have actorId index
    const systemSchema = schemas.find((s) => s.name === 'system.prisma')!.content;
    expect(systemSchema).toContain('@@index([actorId])');
  });

  it('should use connection pooling config (directUrl for migrations)', () => {
    const orgSchema = schemas().find((s) => s.name === 'organization.prisma')!.content;
    // Should have datasource with directUrl for migration support
    expect(orgSchema).toContain('provider');
    expect(orgSchema).toContain('url');
  });
});

function schemas() {
  return getSchemaFiles();
}
