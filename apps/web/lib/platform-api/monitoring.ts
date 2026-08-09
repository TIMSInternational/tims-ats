'use client';

// Monitoring FE data layer — Phase-5 Q0b slice 1 (issue #100), DARK.
//
// Every hook below returns the tRPC path UNLESS both of these are true:
//   1. NEXT_PUBLIC_TIMS_PLATFORM_API_URL is set (`isPlatformApiEnabled()`), and
//   2. NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP === 'true'.
//
// The flag is UNSET everywhere today, so this file changes nothing in production: the TS
// `monitoring.*` procedures remain the single active reader. It exists so the cutover is a deploy
// env-var flip rather than a code change, matching how billing/succession/dei were cut over.
//
// TYPING: the C# minimal-API OpenAPI contract types every numeric field as `number | string` (a
// known read artifact — see the same note in team-intel.ts), so each field is coerced back so the
// returned object is shape-identical to the tRPC output.
//
// ⚠️ `Number(null) === 0`. Two fields here are NULLABLE **because they are k-anonymity suppressed** —
// `pendingAdjustments` and each trend point's `value`. Coercing those with a bare `Number()` would
// turn "suppressed" into a fabricated **0** on the dashboard: not just wrong, but wrong in the
// direction that hides the suppression. They go through `numberOrNull`, which preserves null.

import { useQuery } from '@tanstack/react-query';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet } from './client';

const MONITORING_READ_VIA_CSHARP = process.env.NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP === 'true';

function viaCSharp(): boolean {
  return isPlatformApiEnabled() && MONITORING_READ_VIA_CSHARP;
}

/**
 * Null-preserving numeric coercion — see the suppression warning above. Exported so the invariant
 * "a suppressed null never becomes 0" is directly testable rather than only argued in a comment.
 */
export function numberOrNull(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Date reconstruction. The C# contract types every timestamp as an ISO STRING, while the tRPC path
 * returns a real `Date` — `packages/api/src/trpc.ts` sets `transformer: superjson`, so a Prisma
 * `DateTime` survives serialization as a Date on the client. Without this, flipping
 * NEXT_PUBLIC_MONITORING_READ_VIA_CSHARP would silently change `createdAt`/`dueDate` from `Date` to
 * `string`, breaking this file's own stated invariant ("shape-identical to the tRPC output") and any
 * consumer calling a Date method. Every other platform-api wrapper already does this — the shape is
 * copied verbatim from access-review.ts:97, evaluation360.ts:71 and billing.ts:123.
 */
export const toDate = (v: unknown): Date => new Date(v as string);
export const toDateOrNull = (v: unknown): Date | null => (v == null ? null : new Date(v as string));

// ── Wire shapes ───────────────────────────────────────────────────────────────────────────────
// Field-for-field identical to the tRPC outputs AND to the C# view records.

/** `pendingAdjustments` is null exactly when `pendingAdjustmentsSuppressed` is true (k-anon floor). */
export interface ExecutiveKpis {
  totalEmployees: number;
  activeVacancies: number;
  pendingAdjustments: number | null;
  pendingAdjustmentsSuppressed: boolean;
  activeSurveys: number;
  openAlerts: number;
  turnoverRate: number;
  terminationsLast12m: number;
}

export interface ModuleHealthPoint {
  module: string;
  activeAlerts: number;
  status: string;
}

export interface ActiveAlert {
  id: string;
  severity: string;
  module: string;
  title: string;
  message: string;
  createdAt: Date;
}

export interface ActiveAlertsPage {
  items: ActiveAlert[];
  total: number;
  page: number;
  limit: number;
}

export interface ActionPlanAlert {
  id: string;
  title: string;
  area: string | null;
  status: string;
  dueDate: Date | null;
  responsible: { id: string; firstName: string; lastName: string; avatar: string | null };
}

export interface ActionPlanAlerts {
  items: ActionPlanAlert[];
  total: number;
}

/**
 * Row mappers, exported for the same reason `numberOrNull` is: an invariant that is only argued in
 * a comment is not enforced. Testing `toDate` alone would prove the helper works, not that the
 * wrapper USES it — the hooks' mapping is inline inside `useQuery` and unreachable from a unit
 * test. Extracting them makes the actual reconstruction directly exercisable.
 */
export function mapActiveAlert(a: {
  id: string;
  severity: string;
  module: string;
  title: string;
  message: string;
  createdAt: unknown;
}): ActiveAlert {
  return {
    id: a.id,
    severity: a.severity,
    module: a.module,
    title: a.title,
    message: a.message,
    createdAt: toDate(a.createdAt),
  };
}

export function mapActionPlanAlert(i: {
  id: string;
  title: string;
  area?: string | null;
  status: string;
  dueDate?: unknown;
  responsible: { id: string; firstName: string; lastName: string; avatar?: string | null };
}): ActionPlanAlert {
  return {
    id: i.id,
    title: i.title,
    area: i.area ?? null,
    status: i.status,
    dueDate: toDateOrNull(i.dueDate),
    responsible: {
      id: i.responsible.id,
      firstName: i.responsible.firstName,
      lastName: i.responsible.lastName,
      avatar: i.responsible.avatar ?? null,
    },
  };
}

/**
 * `value` is null exactly when `suppressed` is true — and for the `engagement` metric the flag is
 * ALL-OR-NOTHING across the whole series, never per point (nulling only the sub-floor months would
 * leave a monthly-differencing oracle open). Renderers must treat a suppressed point as "hidden",
 * never as zero.
 */
export interface TrendPoint {
  month: string;
  value: number | null;
  suppressed: boolean;
}

export interface CrossModuleTrend {
  metric: string;
  period: string;
  data: TrendPoint[];
}

export interface AlertRule {
  id: string;
  module: string;
  condition: unknown;
  severity: string;
  message: string;
  isActive: boolean;
}

type TrendMetric = 'headcount' | 'turnover' | 'engagement' | 'alerts';
type TrendPeriod = '6m' | '12m' | '24m';

// ── Hooks ─────────────────────────────────────────────────────────────────────────────────────
// Each calls BOTH paths' hooks unconditionally (React rules of hooks) and returns the selected one;
// the unselected query is `enabled: false` so it never fires a request.

/** Exec KPI tiles. GET /monitoring/executive-kpis. */
export function useMonitoringExecutiveKpis() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getExecutiveKpis.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<ExecutiveKpis>({
    queryKey: ['platform-api', 'monitoring', 'executive-kpis'],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/executive-kpis');
      return {
        totalEmployees: Number(raw.totalEmployees),
        activeVacancies: Number(raw.activeVacancies),
        pendingAdjustments: numberOrNull(raw.pendingAdjustments),
        pendingAdjustmentsSuppressed: raw.pendingAdjustmentsSuppressed,
        activeSurveys: Number(raw.activeSurveys),
        openAlerts: Number(raw.openAlerts),
        turnoverRate: Number(raw.turnoverRate),
        terminationsLast12m: Number(raw.terminationsLast12m),
      };
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** The fixed 8-module health strip. GET /monitoring/module-health. */
export function useMonitoringModuleHealth() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getModuleHealth.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<ModuleHealthPoint[]>({
    queryKey: ['platform-api', 'monitoring', 'module-health'],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/module-health');
      return raw.map((p) => ({
        module: p.module,
        activeAlerts: Number(p.activeAlerts),
        status: p.status,
      }));
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Paged ACTIVE alerts. GET /monitoring/alerts. */
export function useMonitoringActiveAlerts(input?: {
  module?: string;
  severity?: 'info' | 'warning' | 'critical';
  page?: number;
  limit?: number;
}) {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getActiveAlerts.useQuery(input, { enabled: !enabled });
  const csharpQuery = useQuery<ActiveAlertsPage>({
    queryKey: ['platform-api', 'monitoring', 'alerts', input ?? null],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/alerts', {
        module: input?.module,
        severity: input?.severity,
        page: input?.page,
        limit: input?.limit,
      });
      return {
        items: raw.items.map(mapActiveAlert),
        total: Number(raw.total),
        page: Number(raw.page),
        limit: Number(raw.limit),
      };
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Overdue / due-soon climate action plans, ROW-SCOPED by scopeWhereFor('actionPlan'). */
export function useMonitoringActionPlanAlerts() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getActionPlanAlerts.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<ActionPlanAlerts>({
    queryKey: ['platform-api', 'monitoring', 'action-plan-alerts'],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/action-plan-alerts');
      return {
        items: raw.items.map(mapActionPlanAlert),
        total: Number(raw.total),
      };
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Cross-module trend. GET /monitoring/cross-module-trend. */
export function useMonitoringCrossModuleTrend(input: { metric: TrendMetric; period?: TrendPeriod }) {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getCrossModuleTrend.useQuery(input, { enabled: !enabled });
  const csharpQuery = useQuery<CrossModuleTrend>({
    queryKey: ['platform-api', 'monitoring', 'cross-module-trend', input.metric, input.period ?? '12m'],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/cross-module-trend', {
        metric: input.metric,
        period: input.period,
      });
      return {
        metric: raw.metric,
        period: raw.period,
        // numberOrNull, NOT Number: a suppressed point must stay null, never become 0.
        data: raw.data.map((p) => ({ month: p.month, value: numberOrNull(p.value), suppressed: p.suppressed })),
      };
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}

/** Alert-rule list, INCLUDING inactive rules (the read has no isActive filter). */
export function useMonitoringAlertRules() {
  const enabled = viaCSharp();
  const trpcQuery = trpc.monitoring.getAlertRules.useQuery(undefined, { enabled: !enabled });
  const csharpQuery = useQuery<AlertRule[]>({
    queryKey: ['platform-api', 'monitoring', 'alert-rules'],
    queryFn: async () => {
      const raw = await platformGet('/monitoring/alert-rules');
      return raw.map((r) => ({
        id: r.id,
        module: r.module,
        condition: r.condition,
        severity: r.severity,
        message: r.message,
        isActive: r.isActive,
      }));
    },
    enabled,
  });
  return enabled ? csharpQuery : trpcQuery;
}
