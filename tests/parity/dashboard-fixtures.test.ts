/**
 * dashboard-fixtures.test.ts — Phase-5 slice 23 / issue #81 (PRs 1 and 2).
 *
 * The TS half of the dashboard-kernels golden. Both stacks read
 * `contracts/dashboard-fixtures/dashboard-kernels.json`; the C# half is
 * `PlatformDashboardReadUseCaseTests` (`MonthSeries_matches_the_TS_kernel_on_every_golden_case`,
 * `SpanishShortMonths_match_Node_ICU_byte_for_byte`, `SpanishShortMonthYear2_matches_the_golden`,
 * `JsToLocaleString_matches_the_golden`).
 *
 * WHY THIS EXISTS: three of the dashboard procedures format values through ICU, and .NET's own
 * culture data does NOT agree with Node's on any of them. Each hardcoded C# reproduction is pinned
 * here against the REAL Node output so it cannot silently drift from what production emits:
 *
 *  1. `getUserGrowth` — `toLocaleDateString('es', { month: 'short' })`, which Node renders
 *     `["ene",...,"sept",...,"dic"]`. Note "sept" (4 chars), which a .NET `CultureInfo("es")` lookup
 *     does NOT match.
 *  2. `getMrrTrend` / `getMrrForecast` (PR 2) — `toLocaleDateString('es', { month: 'short',
 *     year: '2-digit' })`, a DIFFERENT format string: `"sept 26"`, i.e. the short month, one space,
 *     and a zero-padded two-digit year. Same ICU-divergence class, separately pinned.
 *  3. `getAttentionItems` (PR 2) — `Number.prototype.toLocaleString()` with NO locale argument, which
 *     is baked into an overdue-invoice DESCRIPTION STRING and therefore lands on the wire. See the
 *     locale test below for why that one is an environment dependency, not just a format.
 *
 * It also pins the `buildMonthSeries` kernel the C# `MonthSeries` ports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildMonthSeries } from '../../packages/api/src/routers/platform/time-series';
import { PLAN_PRICES } from '../../packages/api/src/lib/plan-prices';
import { SEARCH_PAGES } from '../../packages/api/src/routers/platform/dashboard.helpers';

const ROOT = join(__dirname, '..', '..');
const golden = JSON.parse(readFileSync(join(ROOT, 'contracts/dashboard-fixtures/dashboard-kernels.json'), 'utf8'));

describe('dashboard kernels golden (shared with Tims.UnitTests)', () => {
  // Two DUPLICATED-CONSTANT pins (PR 2). Unlike the ICU cases above, nothing here can drift because of a
  // runtime upgrade — these fail only when a human edits one stack's copy. That is precisely the risk:
  // repricing a plan or adding a search keyword in TS alone would silently change every MRR figure, or
  // one search result set, on the live path while the C# port kept the old value.
  it('pins PLAN_PRICES, which six dashboard procedures derive every MRR figure from', () => {
    expect(golden.planPrices).toEqual(PLAN_PRICES);
  });

  it('pins the static SEARCH_PAGES list the global search matches against', () => {
    expect(golden.searchPages).toEqual(SEARCH_PAGES);
  });

  it('pins the Spanish short month names to the real toLocaleDateString(es) output', () => {
    const live = Array.from({ length: 12 }, (_, m) =>
      new Date(Date.UTC(2026, m, 1)).toLocaleDateString('es', { month: 'short', timeZone: 'UTC' }),
    );
    expect(golden.spanishShortMonths).toEqual(live);
    // Guard the specific case the C# hardcode exists for — if a Node/ICU upgrade ever changes it, this
    // fails loudly here (and the C# array must be updated in lockstep) rather than diverging silently.
    expect(golden.spanishShortMonths[8]).toBe('sept');
  });

  it('pins the "short month + 2-digit year" labels to the real toLocaleDateString(es) output', () => {
    for (const c of golden.spanishShortMonthYear2Cases) {
      const live = new Date(Date.UTC(c.year, c.monthIndex, 1)).toLocaleDateString('es', {
        month: 'short',
        year: '2-digit',
        timeZone: 'UTC',
      });
      expect(live, `${c.year}-${c.monthIndex}`).toBe(c.label);
    }
    // The two cases the C# composition rule exists for: the 4-char month, and a year whose last two
    // digits are zero-padded rather than truncated to one character.
    expect(golden.spanishShortMonthYear2Cases.find((c: { label: string }) => c.label.startsWith('sept'))).toBeDefined();
    expect(golden.spanishShortMonthYear2Cases.some((c: { label: string }) => c.label === 'ene 00')).toBe(true);
  });

  it('pins Number.prototype.toLocaleString() to the golden, and asserts the default locale is en-US', () => {
    // (a) The golden itself is pinned against an EXPLICIT locale, so this half is deterministic on
    //     every machine and is the exact rule the C# `JsToLocaleString` reproduces.
    for (const c of golden.numberToLocaleStringCases) {
      expect(c.value.toLocaleString('en-US'), String(c.value)).toBe(c.text);
    }

    // (b) …but `dashboard.helpers.ts` calls `inv.amount.toLocaleString()` with NO locale argument, so
    //     production emits whatever ICU resolves as the DEFAULT locale of the Node process — and that
    //     string is embedded in an attention item's `description`, i.e. it is on the wire and compared
    //     by the parity harness. Under `es` the same number renders "1234,5" instead of "1,234.5".
    //     The C# port hardcodes the en-US rule, so if this assertion ever fails the port is wrong (or
    //     the runtime changed underneath it) — which is precisely what we want it to say out loud.
    expect(
      Intl.NumberFormat().resolvedOptions().locale,
      'the C# JsToLocaleString port hardcodes the en-US grouping/decimal rule because that is what ICU ' +
        'resolves to by default; a different default locale here means TS and C# now format invoice ' +
        'amounts differently inside attention-item descriptions',
    ).toBe('en-US');
  });

  it('pins buildMonthSeries on every golden case', () => {
    for (const c of golden.monthSeriesCases) {
      const series = buildMonthSeries(c.rows, c.months, new Date(c.endNowIso));
      expect(series, c.name).toEqual(c.series);
    }
  });
});
