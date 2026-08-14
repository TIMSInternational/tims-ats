/**
 * dashboard-fixtures.test.ts — Phase-5 slice 23 / issue #81 (first PR).
 *
 * The TS half of the dashboard-kernels golden. Both stacks read
 * `contracts/dashboard-fixtures/dashboard-kernels.json`; the C# half is
 * `PlatformDashboardReadUseCaseTests` (`MonthSeries_matches_the_TS_kernel_on_every_golden_case`,
 * `SpanishShortMonths_match_Node_ICU_byte_for_byte`).
 *
 * WHY THIS EXISTS: `getUserGrowth` labels its buckets with `toLocaleDateString('es', { month: 'short' })`,
 * which Node's ICU renders `["ene",...,"sept",...,"dic"]` — note "sept" (4 chars), which a .NET
 * `CultureInfo("es")` lookup does NOT match. The C# port therefore hardcodes the twelve strings, and this
 * test pins the golden to the REAL Node output so the hardcoded C# array cannot silently drift from what
 * production actually emits. It also pins the `buildMonthSeries` kernel the C# `MonthSeries` ports.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { buildMonthSeries } from '../../packages/api/src/routers/platform/time-series';

const ROOT = join(__dirname, '..', '..');
const golden = JSON.parse(readFileSync(join(ROOT, 'contracts/dashboard-fixtures/dashboard-kernels.json'), 'utf8'));

describe('dashboard kernels golden (shared with Tims.UnitTests)', () => {
  it('pins the Spanish short month names to the real toLocaleDateString(es) output', () => {
    const live = Array.from({ length: 12 }, (_, m) =>
      new Date(Date.UTC(2026, m, 1)).toLocaleDateString('es', { month: 'short', timeZone: 'UTC' }),
    );
    expect(golden.spanishShortMonths).toEqual(live);
    // Guard the specific case the C# hardcode exists for — if a Node/ICU upgrade ever changes it, this
    // fails loudly here (and the C# array must be updated in lockstep) rather than diverging silently.
    expect(golden.spanishShortMonths[8]).toBe('sept');
  });

  it('pins buildMonthSeries on every golden case', () => {
    for (const c of golden.monthSeriesCases) {
      const series = buildMonthSeries(c.rows, c.months, new Date(c.endNowIso));
      expect(series, c.name).toEqual(c.series);
    }
  });
});
