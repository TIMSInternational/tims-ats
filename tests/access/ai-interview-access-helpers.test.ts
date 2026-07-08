// tests/access/ai-interview-access-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('ai-interview-access.service impure loaders', () => {
  const src = read('packages/api/src/services/ai-interview-access.service.ts');

  it('exports the three loaders', () => {
    expect(src).toContain('export async function loadAiInterviewConfig');
    expect(src).toContain('export async function isAiInterviewEnabled');
    expect(src).toContain('export async function assertAiInterviewEnabled');
  });
  it('uses systemDb (not tenantDb) with an explicit organizationId filter', () => {
    expect(src).toMatch(/import\s+\{[^}]*\bdb as systemDb\b[^}]*\}\s+from\s+'@tims\/db'/);
    expect(src).not.toMatch(/\btenantDb\b/);
    expect(src).toContain('organizationId');
    expect(src).toContain('AI_VOICE_INTERVIEW_SLUG');
  });
  it('assert gates via the ai_voice_interview entitlement (fail-closed, delegated to requireEntitlement)', () => {
    // Task 5: enablement moved from a local FORBIDDEN throw on aiAgentOrgConfig.enabled
    // to requireEntitlement — it throws FORBIDDEN (entitlement_missing:<code>) itself.
    expect(src).toMatch(/import\s+\{[^}]*\brequireEntitlement\b[^}]*\}\s+from\s+'\.\/entitlement\.service'/);
    expect(src).toContain("requireEntitlement(organizationId, 'ai_voice_interview')");
    expect(src).toContain('isEnabledConfig');
  });
  it('selects the cap + billing columns it returns', () => {
    expect(src).toContain('billableUsdPerMinute');
    expect(src).toContain('aiInterviewDefaultMaxMinutes');
    expect(src).toContain('aiInterviewMaxMinutesByType');
  });
});
