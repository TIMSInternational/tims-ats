// tests/access/ai-interview-platform-admin.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('platform billing preview query', () => {
  const src = read('packages/api/src/routers/platform/ai-agents.ts');
  it('exposes a platform-guarded getAiInterviewBillingPreview', () => {
    expect(src).toMatch(/getAiInterviewBillingPreview:\s*platformProcedure/);
    expect(src).toContain('buildAiInterviewInvoiceLines');
    expect(src).toContain('billableUsd');
  });
  it('reads the target org with an explicit organizationId filter (systemDb)', () => {
    expect(src).toContain('organizationId');
    expect(src).toContain('AI_VOICE_INTERVIEW_SLUG');
  });
});

describe('invoice wizard: load AI-interview charges', () => {
  const wiz = read('apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  it('offers a button that appends preview line items', () => {
    expect(wiz).toContain('getAiInterviewBillingPreview');
    expect(wiz).toContain('loadAiInterviewCharges');
    expect(wiz).not.toContain('style={{');
  });
  it('both locales define the button label', () => {
    expect(en.invoices.loadAiInterviewCharges).toBeTruthy();
    expect(es.invoices.loadAiInterviewCharges).toBeTruthy();
  });
});

describe('platform admin: config mutation + drawer controls', () => {
  const router = read('packages/api/src/routers/platform/ai-agents.ts');
  const drawer = read('apps/web/app/(admin)/platform/ai-agents/ai-interview-org-controls.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));

  it('updateAiAgentOrgConfig accepts the new add-on/cap fields', () => {
    expect(router).toContain('addonMonthlyFeeUsd');
    expect(router).toContain('billableUsdPerMinute');
    expect(router).toContain('aiInterviewDefaultMaxMinutes');
    expect(router).toContain('aiInterviewMaxMinutesByType');
    // null clears the Json field safely
    expect(router).toContain('DbNull');
  });
  it('drawer renders the add-on controls gated to the voice-interview agent', () => {
    expect(drawer).toContain('ai-voice-interview');
    expect(drawer).toContain('addonMonthlyFeeUsd');
    expect(drawer).toContain('billableUsdPerMinute');
    expect(drawer).toContain('getAiInterviewBillingPreview');
    expect(drawer).not.toContain('style={{');
    expect(drawer).not.toMatch(/:\s*any\b/);
  });
  it('both locales define the new aiAgents labels', () => {
    for (const dict of [en, es]) {
      expect(dict.aiAgents.addonFeeLabel).toBeTruthy();
      expect(dict.aiAgents.perMinuteLabel).toBeTruthy();
      expect(dict.aiAgents.defaultCapLabel).toBeTruthy();
      expect(dict.aiAgents.perTypeCapsLabel).toBeTruthy();
      expect(dict.aiAgents.accruedUsageLabel).toBeTruthy();
      expect(dict.aiAgents.addonInvalidJson).toBeTruthy();
    }
  });
});
