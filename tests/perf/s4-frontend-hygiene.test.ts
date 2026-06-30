/**
 * s4-frontend-hygiene.test.ts  (Task 4 — S4 tripwire)
 *
 * Static source checks:
 *  1. recruiting-kpi-strip.tsx has NO getDashboardKpis useQuery calls
 *     (data is received via props instead).
 *  2. alerts-sla-panel.tsx accepts a vacancyId prop and gates its dependent
 *     query with { enabled: !!vacancyId } — no standalone vacancy.list call.
 *     Also accepts vacanciesLoading prop and uses it in isLoading guard.
 *  3. alerts-risk-panel.tsx accepts a vacancyId prop and gates its dependent
 *     query with { enabled: !!vacancyId } — no standalone vacancy.list call.
 *     Also accepts vacanciesLoading prop and uses it in isLoading guard.
 *  4. trpc-provider.tsx sets staleTime: 300_000 (5 min).
 *  5. pipeline-funnel.tsx has NO vacancy.list.useQuery self-fetch
 *     (receives vacancies as a prop from the parent instead).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(__dirname, '..', '..');

function readSrc(rel: string) {
  return readFileSync(resolve(ROOT, rel), 'utf-8');
}

const kpiStrip = readSrc('apps/web/app/(admin)/dashboard/recruiting-kpi-strip.tsx');
const slaPanel = readSrc('apps/web/app/(admin)/dashboard/alerts-sla-panel.tsx');
const riskPanel = readSrc('apps/web/app/(admin)/dashboard/alerts-risk-panel.tsx');
const trpcProvider = readSrc('apps/web/lib/trpc-provider.tsx');
const pipelineFunnel = readSrc('apps/web/app/(admin)/dashboard/pipeline-funnel.tsx');

describe('s4-frontend-hygiene tripwire', () => {
  // ── 1. RecruitingKpiStrip: no more self-fetching ──────────────────────────
  it('recruiting-kpi-strip.tsx has no getDashboardKpis useQuery', () => {
    expect(kpiStrip).not.toMatch(/getDashboardKpis\s*\.\s*useQuery/);
  });

  it('recruiting-kpi-strip.tsx accepts vacancyKpis prop', () => {
    expect(kpiStrip).toMatch(/vacancyKpis/);
  });

  it('recruiting-kpi-strip.tsx accepts candidateKpis prop', () => {
    expect(kpiStrip).toMatch(/candidateKpis/);
  });

  // ── 2. AlertsSlaPanel: vacancyId prop + gated query + vacanciesLoading prop ─
  it('alerts-sla-panel.tsx has no vacancy.list.useQuery call', () => {
    expect(slaPanel).not.toMatch(/vacancy\.list\.useQuery/);
  });

  it('alerts-sla-panel.tsx accepts a vacancyId prop', () => {
    expect(slaPanel).toMatch(/vacancyId/);
  });

  it('alerts-sla-panel.tsx gates dependent query with enabled: !!vacancyId', () => {
    expect(slaPanel).toMatch(/enabled\s*:\s*!!\s*vacancyId/);
  });

  it('alerts-sla-panel.tsx accepts vacanciesLoading prop and uses it in isLoading', () => {
    expect(slaPanel).toMatch(/vacanciesLoading/);
    expect(slaPanel).toMatch(/vacanciesLoading\s*\|\|\s*\w+\.isLoading/);
  });

  it('alerts-sla-panel.tsx does not use !vacancyId as loading guard', () => {
    expect(slaPanel).not.toMatch(/isLoading\s*=\s*!vacancyId/);
  });

  // ── 3. AlertsRiskPanel: vacancyId prop + gated query + vacanciesLoading prop ─
  it('alerts-risk-panel.tsx has no vacancy.list.useQuery call', () => {
    expect(riskPanel).not.toMatch(/vacancy\.list\.useQuery/);
  });

  it('alerts-risk-panel.tsx accepts a vacancyId prop', () => {
    expect(riskPanel).toMatch(/vacancyId/);
  });

  it('alerts-risk-panel.tsx gates dependent query with enabled: !!vacancyId', () => {
    expect(riskPanel).toMatch(/enabled\s*:\s*!!\s*vacancyId/);
  });

  it('alerts-risk-panel.tsx accepts vacanciesLoading prop and uses it in isLoading', () => {
    expect(riskPanel).toMatch(/vacanciesLoading/);
    expect(riskPanel).toMatch(/vacanciesLoading\s*\|\|\s*\w+\.isLoading/);
  });

  it('alerts-risk-panel.tsx does not use !vacancyId as loading guard', () => {
    expect(riskPanel).not.toMatch(/isLoading\s*=\s*!vacancyId/);
  });

  // ── 4. TRPCProvider: staleTime raised to 5 min ────────────────────────────
  it('trpc-provider.tsx sets staleTime to 300_000', () => {
    expect(trpcProvider).toMatch(/staleTime\s*:\s*300[_]?000/);
  });

  // ── 5. PipelineFunnel: no self-fetch of vacancy.list ─────────────────────
  it('pipeline-funnel.tsx has no vacancy.list.useQuery call', () => {
    expect(pipelineFunnel).not.toMatch(/vacancy\.list\.useQuery/);
  });

  it('pipeline-funnel.tsx accepts a vacancies prop', () => {
    expect(pipelineFunnel).toMatch(/vacancies/);
  });
});
