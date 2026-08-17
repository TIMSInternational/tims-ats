import { describe, it, expect } from 'vitest';

/**
 * dashboard-fe-coercion.test.ts — Phase-5 slice 23 step 4 (issue #81).
 *
 * The platform-dashboard endpoints expose untyped 200s (`.Produces(200)` with no `<T>`), so the FE
 * wrapper hand-types the wire and coerces every numeric back from the contract's
 * `number | string` convention. Three of those fields are nullable with an INVERTED meaning at 0:
 *
 *   - churn-risk `daysSinceLastLogin`: null = "no login EVER", 0 = "logged in today".
 *   - customer-health `signals.trialDaysLeft`: null = "not on a trial", 0 = "expires today".
 *   - ai-cost-anomalies `monthlyBudget`: null = "no budget configured", 0 = a real zero budget —
 *     and the TS anomaly rule (`monthlyBudget && cost > monthlyBudget`) treats them differently.
 *
 * `Number(null) === 0`, so a bare `Number()` on any of them fabricates the OPPOSITE reading.
 * These exercise the REAL row mappers the hooks call (the hooks' inline mapping is unreachable
 * from a unit test) — testing the helper alone would prove the helper works, not that the wrapper
 * uses it. Same defect class and same layering as tests/monitoring/monitoring-fe-coercion.test.ts.
 */
import {
  numberOrNull,
  numberOrUndefined,
  mapDashboardKpis,
  mapAttentionItem,
  mapRevenueByCustomerRow,
  mapCustomerHealthRow,
  mapRecentActivityItem,
  mapSearchResults,
  mapMrrTrendPoint,
  mapPlanDistributionRow,
  mapChurnRiskOrg,
  mapMrrForecast,
  mapUpsellOpportunities,
  mapAiCostAnomalies,
} from '../../apps/web/lib/platform-api/dashboard';

describe('null-preserving helpers', () => {
  it('numberOrNull preserves null and undefined as null, never 0 or NaN', () => {
    expect(numberOrNull(null)).toBeNull();
    expect(numberOrNull(undefined)).toBeNull();
    expect(numberOrNull(null)).not.toBe(0);
  });

  it('numberOrUndefined lands both null (C# wire) and absent (tRPC) as undefined', () => {
    // superjson hands the tRPC consumer `undefined` for a written-undefined key; the C# wire emits
    // null for the same key. Both must collapse to undefined so the paths are indistinguishable.
    expect(numberOrUndefined(null)).toBeUndefined();
    expect(numberOrUndefined(undefined)).toBeUndefined();
  });

  it('both coerce the contract string form and pass a genuine 0 through', () => {
    expect(numberOrNull('7')).toBe(7);
    expect(numberOrNull(0)).toBe(0);
    expect(numberOrUndefined('7')).toBe(7);
    expect(numberOrUndefined(0)).toBe(0);
  });

  it('is distinguishable from a bare Number() on the null input — the bug, stated', () => {
    expect(Number(null)).toBe(0);
    expect(numberOrNull(null)).not.toBe(0);
  });
});

describe('mapChurnRiskOrg — null daysSinceLastLogin must never become "logged in today"', () => {
  const base = {
    orgId: 'o1',
    orgName: 'Acme',
    plan: 'starter' as const,
    mrr: '499',
    healthScore: '35',
    tier: 'red' as const,
    totalUsers: '4',
    loginRate: '0',
    daysSinceLastLogin: null as number | string | null,
    overdueInvoices: '2',
    overdueAmount: '1200',
    currency: 'USD',
    overdueAmountConverted: false,
    featureCount: '1',
    primaryRisk: 'No login in 999 days',
    risks: ['r'],
    actions: ['a'],
    signals: { loginScore: '0', invoiceScore: '0', recencyScore: '0', adoptionScore: '4', tenureScore: '2' },
  };

  it('null stays null (no login EVER) — a 0 would be the opposite end of the risk scale', () => {
    const out = mapChurnRiskOrg(base);
    expect(out.daysSinceLastLogin).toBeNull();
    expect(out.daysSinceLastLogin).not.toBe(0);
  });

  it('a real recency coerces off the string form, and the score signals coerce too', () => {
    const out = mapChurnRiskOrg({ ...base, daysSinceLastLogin: '3' });
    expect(out.daysSinceLastLogin).toBe(3);
    expect(out.healthScore).toBe(35);
    expect(out.signals.adoptionScore).toBe(4);
  });
});

describe('mapCustomerHealthRow — trialDaysLeft null must not read as "expires today"', () => {
  const base = {
    orgId: 'o1',
    orgName: 'Acme',
    plan: 'professional' as const,
    health: 'healthy' as const,
    signals: {
      loginRate: '80',
      overdueInvoices: '0',
      trialDaysLeft: null as number | string | null,
      daysSinceLastLogin: '999',
    },
  };

  it('a non-trial org keeps trialDaysLeft null — 0 would light at_risk for every non-trial org', () => {
    const out = mapCustomerHealthRow(base);
    expect(out.signals.trialDaysLeft).toBeNull();
    expect(out.signals.trialDaysLeft).not.toBe(0);
  });

  it('daysSinceLastLogin keeps the 999 no-login sentinel — the TS procedure keeps it on THIS wire', () => {
    // Only churn-risk maps 999 → null; customer-health does not. Reproduce, don't improve.
    expect(mapCustomerHealthRow(base).signals.daysSinceLastLogin).toBe(999);
  });

  it('a real trial coerces the string form', () => {
    const out = mapCustomerHealthRow({ ...base, signals: { ...base.signals, trialDaysLeft: '4' } });
    expect(out.signals.trialDaysLeft).toBe(4);
  });
});

describe('mapAiCostAnomalies — a null budget is not a zero budget', () => {
  const anomaly = {
    type: 'zero_usage' as const,
    agentName: 'CV Parser',
    agentSlug: 'cv-parser',
    orgName: 'Acme',
    orgId: 'o1',
    detail: 'Enabled but 0 calls in 30 days',
    monthlyCost: '0',
    monthlyBudget: null as number | string | null,
    potentialSavings: '1.5',
  };
  const base = {
    anomalies: [anomaly],
    totalPotentialSavings: '1.5',
    zeroUsageCount: '1',
    overBudgetCount: '0',
  };

  it('null monthlyBudget stays null — the TS rule `monthlyBudget && cost > budget` treats 0 and null differently', () => {
    const out = mapAiCostAnomalies(base);
    expect(out.anomalies[0].monthlyBudget).toBeNull();
    expect(out.anomalies[0].monthlyBudget).not.toBe(0);
  });

  it('a genuine zero budget stays 0, distinguishable from unconfigured', () => {
    const out = mapAiCostAnomalies({ ...base, anomalies: [{ ...anomaly, monthlyBudget: 0 }] });
    expect(out.anomalies[0].monthlyBudget).toBe(0);
  });

  it('the aggregate counters coerce off the string form', () => {
    const out = mapAiCostAnomalies(base);
    expect(out.totalPotentialSavings).toBe(1.5);
    expect(out.zeroUsageCount).toBe(1);
    expect(out.overBudgetCount).toBe(0);
  });
});

describe('date reconstruction — the two datetime wires of the thirteen', () => {
  it('mapRecentActivityItem reconstructs timestamp as a Date', () => {
    const out = mapRecentActivityItem({
      id: 'a1',
      type: 'org_created',
      title: 'Nueva organizacion: Acme',
      timestamp: '2026-08-17T01:23:45.000Z',
      meta: 'starter',
    });
    expect(out.timestamp).toBeInstanceOf(Date);
    expect(out.timestamp.toISOString()).toBe('2026-08-17T01:23:45.000Z');
  });

  it('mapRevenueByCustomerRow reconstructs lastActiveAt as a Date', () => {
    const out = mapRevenueByCustomerRow({
      orgId: 'o1',
      orgName: 'Acme',
      plan: 'starter',
      mrr: '499',
      paidLast30d: '0',
      outstandingAmount: '0',
      currency: 'USD',
      converted: false,
      userCount: '3',
      lastActiveAt: '2026-08-16T12:00:00.000Z',
    });
    expect(out.lastActiveAt).toBeInstanceOf(Date);
    expect((out.lastActiveAt as Date).toISOString()).toBe('2026-08-16T12:00:00.000Z');
  });

  it('a NULL lastActiveAt stays null — never epoch 1970', () => {
    // `new Date(null)` is 1970-01-01: a bare toDate() would render every never-logged-in org as
    // "last active 56 years ago" instead of blank. Same failure shape as Number(null) === 0.
    const out = mapRevenueByCustomerRow({
      orgId: 'o1',
      orgName: 'Acme',
      plan: 'trial',
      mrr: '0',
      paidLast30d: '0',
      outstandingAmount: '0',
      currency: 'USD',
      converted: false,
      userCount: '0',
      lastActiveAt: null,
    });
    expect(out.lastActiveAt).toBeNull();
    expect(new Date(null as unknown as string).getTime()).toBe(0); // the bug, stated
  });
});

describe('mapAttentionItem — optional-key normalization (C# null ≡ tRPC undefined)', () => {
  const base = {
    id: 'i1',
    type: 'pending_invitation' as const,
    severity: 'info' as const,
    title: 'Invitacion sin aceptar - a@b.co',
    description: 'Enviada hace 6 dias',
    actionUrl: '/platform/invitations',
    actionLabel: 'Reenviar',
  };

  it('a null orgId (org-less invitation on the C# wire) lands as undefined, like the tRPC path', () => {
    const out = mapAttentionItem({ ...base, orgId: null, orgName: null });
    expect(out.orgId).toBeUndefined();
    expect(out.orgName).toBeUndefined();
  });

  it('absent amount/daysUntil stay undefined, never NaN or 0', () => {
    const out = mapAttentionItem(base);
    expect(out.amount).toBeUndefined();
    expect(out.daysUntil).toBeUndefined();
  });

  it('a present amount coerces the string form, and a NEGATIVE daysUntil survives (overdue)', () => {
    const out = mapAttentionItem({
      ...base,
      type: 'overdue_invoice',
      severity: 'critical',
      amount: '1200',
      daysUntil: '-3',
    });
    expect(out.amount).toBe(1200);
    expect(out.daysUntil).toBe(-3);
  });
});

describe('remaining wires — spot coercions', () => {
  it('mapDashboardKpis coerces numerics and passes outstandingRatesAsOf through as string | null', () => {
    const out = mapDashboardKpis({
      totalOrgs: '12',
      totalOrgsChange: '2',
      totalUsers: '300',
      totalUsersChange: '25',
      mrr: '4990',
      mrrPrevMonth: '4491',
      activeTrials: '3',
      trialsExpiringThisWeek: '1',
      overdueInvoices: '2',
      outstandingAmount: '1200.5',
      currency: 'USD',
      outstandingConverted: true,
      outstandingRatesAsOf: '2026-07-31',
    });
    expect(out.totalOrgs).toBe(12);
    expect(out.outstandingAmount).toBe(1200.5);
    // A string passthrough, NOT a Date: the tRPC path serves a string here too.
    expect(out.outstandingRatesAsOf).toBe('2026-07-31');
    expect(mapDashboardKpis({ ...out, outstandingRatesAsOf: null }).outstandingRatesAsOf).toBeNull();
  });

  it('mapSearchResults preserves avatar null and organization null (nullable, NOT optional-key)', () => {
    const out = mapSearchResults({
      organizations: [{ id: 'o1', name: 'Acme', slug: 'acme', plan: 'starter', isActive: true }],
      users: [
        {
          id: 'u1',
          firstName: 'Ana',
          lastName: 'Diaz',
          email: 'ana@acme.co',
          isPlatformOwner: true,
          isActive: true,
          avatar: null,
          organization: null,
        },
      ],
      pages: [{ name: 'Dashboard', href: '/dashboard', keywords: 'inicio home panel' }],
    });
    expect(out.users[0].avatar).toBeNull();
    expect(out.users[0].organization).toBeNull();
    expect(out.organizations[0].plan).toBe('starter');
    expect(out.pages[0].href).toBe('/dashboard');
  });

  it('mapMrrTrendPoint and mapPlanDistributionRow coerce the string form', () => {
    expect(mapMrrTrendPoint({ month: 'ago 26', mrr: '4990' }).mrr).toBe(4990);
    const row = mapPlanDistributionRow({ plan: 'starter', count: '4', percentage: '33' });
    expect(row.count).toBe(4);
    expect(row.percentage).toBe(33);
  });

  it('mapMrrForecast coerces planBreakdown values and keeps the historical/projected type literals', () => {
    const out = mapMrrForecast({
      historical: [{ month: 'sep 25', mrr: '3000', type: 'historical' }],
      projected: [{ month: 'sep 26', mrr: '5500', type: 'projected' }],
      currentMrr: '4990',
      projectedMrr12m: '5500',
      projectedArr: '66000',
      monthlyGrowthPct: '1.2',
      planBreakdown: { starter: { count: '4', mrr: '1996' } },
      pendingTrials: '3',
      potentialMrrFromTrials: '1497',
    });
    expect(out.historical[0]).toEqual({ month: 'sep 25', mrr: 3000, type: 'historical' });
    expect(out.projected[0].type).toBe('projected');
    expect(out.planBreakdown.starter).toEqual({ count: 4, mrr: 1996 });
    expect(out.monthlyGrowthPct).toBe(1.2);
  });

  it('mapUpsellOpportunities coerces nested signals and the aggregate counters', () => {
    const out = mapUpsellOpportunities({
      opportunities: [
        {
          orgId: 'o1',
          orgName: 'Acme',
          currentPlan: 'starter',
          targetPlan: 'professional',
          mrrIncrease: '500',
          reason: '8 users (threshold: 8)',
          signals: { activeUsers: '6', totalUsers: '8', features: '5', vacancies: '3' },
          confidence: 'high',
        },
      ],
      totalPotentialMrr: '500',
      highConfidence: '1',
      mediumConfidence: '0',
    });
    expect(out.opportunities[0].mrrIncrease).toBe(500);
    expect(out.opportunities[0].signals.activeUsers).toBe(6);
    expect(out.totalPotentialMrr).toBe(500);
  });
});
