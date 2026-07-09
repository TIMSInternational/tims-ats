// tests/access/ai-interview-addon-gate.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('schema: AiAgentOrgConfig add-on + cap columns', () => {
  const src = read('packages/db/prisma/schema/ai-agent.prisma');
  it('adds the four config columns', () => {
    expect(src).toMatch(/addonMonthlyFeeUsd\s+Float\?\s+@map\("addon_monthly_fee_usd"\)/);
    expect(src).toMatch(/billableUsdPerMinute\s+Float\?\s+@map\("billable_usd_per_minute"\)/);
    expect(src).toMatch(/aiInterviewDefaultMaxMinutes\s+Int\?\s+@map\("ai_interview_default_max_minutes"\)/);
    expect(src).toMatch(/aiInterviewMaxMinutesByType\s+Json\?\s+@map\("ai_interview_max_minutes_by_type"\)/);
  });
});

describe('schema: AiInterviewSession duration cap column', () => {
  const src = read('packages/db/prisma/schema/ai-interview.prisma');
  it('adds maxDurationSeconds', () => {
    expect(src).toMatch(/maxDurationSeconds\s+Int\?\s+@map\("max_duration_seconds"\)/);
  });
});

describe('migration: ai_interview_addon_caps', () => {
  const sql = read('packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql');
  it('adds all five columns idempotently', () => {
    expect(sql).toContain('addon_monthly_fee_usd');
    expect(sql).toContain('billable_usd_per_minute');
    expect(sql).toContain('ai_interview_default_max_minutes');
    expect(sql).toContain('ai_interview_max_minutes_by_type');
    expect(sql).toContain('max_duration_seconds');
    expect(sql).toContain('duplicate_column'); // idempotent guards present
  });
});

describe('create wiring: gate + cap', () => {
  const svc = read('packages/api/src/services/ai-interview.service.ts');
  const repo = read('packages/api/src/repositories/ai-interview.repository.ts');
  it('createAiInterviewSession asserts the feature is enabled', () => {
    expect(svc).toContain('assertAiInterviewEnabled');
  });
  it('resolves and persists maxDurationSeconds at create', () => {
    expect(svc).toContain('resolveMaxDurationSeconds');
    expect(svc).toContain('maxDurationSeconds');
  });
  it('repository createSession accepts + writes maxDurationSeconds', () => {
    expect(repo).toContain('maxDurationSeconds');
  });
});

describe('start wiring: gate + cap return', () => {
  const router = read('packages/api/src/routers/ai-interview.ts');
  const repo = read('packages/api/src/repositories/ai-interview.repository.ts');
  it('start asserts the feature is enabled (before budget gate)', () => {
    expect(router).toContain('assertAiInterviewEnabled');
    // gate appears before the budget-spend aggregate
    expect(router.indexOf('assertAiInterviewEnabled')).toBeLessThan(router.indexOf('aiAgentUsageLog.aggregate'));
  });
  it('start returns maxDurationSeconds and feeds it to getSignedUrl', () => {
    expect(router).toMatch(/maxDurationSeconds:\s*session\.maxDurationSeconds/);
    expect(router).not.toContain('maxDurationSeconds: 3600');
  });
  it('candidate-token session select includes maxDurationSeconds', () => {
    expect(repo).toContain('maxDurationSeconds');
  });
});

describe('isEnabled query', () => {
  const router = read('packages/api/src/routers/ai-interview.ts');
  it('exposes a protected isEnabled query reading the org config', () => {
    expect(router).toMatch(/isEnabled:\s*protectedProcedure/);
    expect(router).toContain('isAiInterviewEnabled');
    expect(router).toContain('ctx.user.organizationId');
  });
});

describe('recruiter UI gating', () => {
  const page = read('apps/web/app/(admin)/recruitment/interviews/page.tsx');
  const table = read('apps/web/app/(admin)/recruitment/interviews/interview-table.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));

  it('page queries isEnabled and passes the flag to the table', () => {
    expect(page).toContain('aiInterview.isEnabled.useQuery');
    expect(page).toContain('aiScreenEnabled');
  });
  it('table gates the AI screen button on aiScreenEnabled and offers an upsell', () => {
    expect(table).toContain('aiScreenEnabled');
    // Slice 2a.1: the not-entitled branch renders the reusable UpsellNotice
    // fed by the entitlements upsell copy (replaced the old interviews.aiScreenUpsell* keys).
    expect(table).toContain('UpsellNotice');
    expect(table).toContain('entitlements.notIncluded');
    expect(table).not.toContain('style={{');
  });
  it('both locales define the upsell keys', () => {
    for (const dict of [en, es]) {
      expect(dict.entitlements.notIncluded).toBeTruthy();
      expect(dict.entitlements.contactSales).toBeTruthy();
    }
  });
});

describe('call-UI auto-end wiring', () => {
  const DIR = 'apps/web/app/(portal)/ai-interview/[token]';
  const hook = read(`${DIR}/use-interview-call.ts`);
  const shell = read(`${DIR}/call-shell.tsx`);
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  it('hook exposes maxDurationSeconds from start', () => {
    expect(hook).toContain('maxDurationSeconds');
    expect(hook).not.toMatch(/:\s*any\b/);
  });
  it('shell auto-ends via shouldAutoEnd', () => {
    expect(shell).toContain('shouldAutoEnd');
    expect(shell).toContain('call.end');
    expect(shell).not.toContain('style={{');
  });
  it('both locales define aiInterview.timeUp', () => {
    expect(en.aiInterview.timeUp).toBeTruthy();
    expect(es.aiInterview.timeUp).toBeTruthy();
  });
});

describe('schema/migration: AiAgentUsageLog.billableUsd', () => {
  const root2 = resolve(__dirname, '../..');
  const read2 = (p: string) => readFileSync(resolve(root2, p), 'utf8');
  it('schema adds billableUsd with default 0', () => {
    expect(read2('packages/db/prisma/schema/ai-agent.prisma')).toMatch(/billableUsd\s+Float\s+@default\(0\)\s+@map\("billable_usd"\)/);
  });
  it('migration adds billable_usd column idempotently', () => {
    const sql = read2('packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql');
    expect(sql).toContain('billable_usd');
    expect(sql).toContain('duplicate_column');
  });
});
