import { describe, expect, it } from 'vitest';
import {
  interviewStatusFilterWhere,
  STARTED_UNSCORED_FILTER,
} from '../../packages/api/src/repositories/interview-status-filter';
import {
  displayInterviewStatus,
  STARTED_UNSCORED_FILTER as WEB_STARTED_UNSCORED_FILTER,
} from '../../apps/web/app/(admin)/recruitment/interviews/interview-status';

// A-02 / B-30: the interviews list badges a row by displayInterviewStatus (web), and its status filter
// is a Prisma where built on the server. Every value the filter bar offers must return EXACTLY the rows
// badged that way — "Programada" never returns an interview that already started.
//
// The where is evaluated here by a tiny interpreter of the operators it uses; any other operator throws,
// so a change in the filter's shape fails loudly instead of passing vacuously.

type Card = { submittedAt: Date | null };
type Row = { label: string; status: string; scheduledAt: Date; duration: number; scorecards: Card[] };

function matchScalar(value: string, cond: unknown): boolean {
  if (typeof cond === 'string') return value === cond;
  const c = cond as { in?: string[] };
  if (Array.isArray(c.in) && Object.keys(c).length === 1) return c.in.includes(value);
  throw new Error(`unsupported scalar condition ${JSON.stringify(cond)}`);
}

function matchDate(value: Date, cond: unknown): boolean {
  return Object.entries(cond as Record<string, Date>).every(([op, d]) => {
    if (op === 'lte') return value.getTime() <= d.getTime();
    if (op === 'gt') return value.getTime() > d.getTime();
    throw new Error(`unsupported date operator ${op}`);
  });
}

function matchCard(card: Card, cond: unknown): boolean {
  if (JSON.stringify(cond) === JSON.stringify({ submittedAt: { not: null } })) return card.submittedAt !== null;
  throw new Error(`unsupported scorecard condition ${JSON.stringify(cond)}`);
}

function matches(where: unknown, row: Row): boolean {
  return Object.entries(where as Record<string, unknown>).every(([key, cond]) => {
    if (key === 'AND') return (cond as unknown[]).every((w) => matches(w, row));
    if (key === 'OR') return (cond as unknown[]).some((w) => matches(w, row));
    if (key === 'NOT') return !matches(cond, row);
    if (key === 'status') return matchScalar(row.status, cond);
    if (key === 'scheduledAt') return matchDate(row.scheduledAt, cond);
    if (key === 'scorecards') {
      const rel = cond as { some?: unknown; none?: unknown };
      if (rel.some !== undefined) return row.scorecards.some((c) => matchCard(c, rel.some));
      if (rel.none !== undefined) return !row.scorecards.some((c) => matchCard(c, rel.none));
    }
    throw new Error(`unsupported where key ${key}`);
  });
}

const NOW = new Date('2026-11-10T16:00:00Z');
const MIN = 60_000;
const TIMINGS = { future: 60 * MIN, running: -30 * MIN, over: -3 * 60 * MIN } as const;
const CARDS: Record<string, Card[]> = {
  none: [],
  draft: [{ submittedAt: null }],
  submitted: [{ submittedAt: new Date(NOW.getTime() - MIN) }, { submittedAt: null }],
};
const STATUSES = ['scheduled', 'rescheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];

const ROWS: Row[] = STATUSES.flatMap((status) =>
  Object.entries(TIMINGS).flatMap(([timing, offset]) =>
    Object.entries(CARDS).map(([cards, scorecards]) => ({
      label: `${status}/${timing}/${cards}`,
      status,
      scheduledAt: new Date(NOW.getTime() + offset),
      duration: 60,
      scorecards,
    })),
  ),
);

function badge(row: Row): string {
  const submitted = row.scorecards.filter((c) => c.submittedAt !== null).length;
  return displayInterviewStatus({ ...row, _count: { scorecards: submitted } }, NOW);
}

// Filter-bar value → the badges it stands for.
const OFFERED: Record<string, readonly string[]> = {
  scheduled: ['scheduled'],
  [STARTED_UNSCORED_FILTER]: ['in_progress', 'awaiting_scorecard'],
  completed: ['completed'],
  cancelled: ['cancelled'],
  no_show: ['no_show'],
};

describe('interview status filter = the badge rule', () => {
  it('web and server agree on the started-unscored filter value', () => {
    expect(WEB_STARTED_UNSCORED_FILTER).toBe(STARTED_UNSCORED_FILTER);
  });

  it('the fixture covers every badge', () => {
    expect(new Set(ROWS.map(badge))).toEqual(new Set([...STATUSES, 'awaiting_scorecard']));
  });

  it.each(Object.entries(OFFERED))('"%s" returns exactly the rows badged %j', (value, badges) => {
    const where = interviewStatusFilterWhere(value, NOW);
    const mismatches = ROWS.filter((row) => matches(where, row) !== badges.includes(badge(row))).map(
      (row) => `${row.label} → badge ${badge(row)}`,
    );
    expect(mismatches).toEqual([]);
  });

  it('"Programada" excludes interviews that have started, scored or not', () => {
    const where = interviewStatusFilterWhere('scheduled', NOW);
    const started = ROWS.filter((r) => r.status === 'scheduled' && r.scheduledAt.getTime() <= NOW.getTime());
    expect(started.length).toBeGreaterThan(0);
    for (const row of started) expect(matches(where, row)).toBe(false);
    const upcoming = ROWS.filter((r) => r.status === 'scheduled' && r.scheduledAt.getTime() > NOW.getTime());
    for (const row of upcoming) expect(matches(where, row)).toBe(true);
  });

  it('the legacy in_progress value returns every row badged "En curso" (a superset: duration is per row)', () => {
    const where = interviewStatusFilterWhere('in_progress', NOW);
    for (const row of ROWS.filter((r) => badge(r) === 'in_progress')) expect(matches(where, row)).toBe(true);
    expect(
      ROWS.filter((r) => matches(where, r)).every((r) => ['in_progress', 'awaiting_scorecard'].includes(badge(r))),
    ).toBe(true);
  });

  it('no status → no condition', () => {
    expect(interviewStatusFilterWhere(undefined, NOW)).toEqual({});
    expect(interviewStatusFilterWhere('', NOW)).toEqual({});
  });
});
