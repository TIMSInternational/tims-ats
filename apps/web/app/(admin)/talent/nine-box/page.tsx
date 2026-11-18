'use client';

import { useState, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSuccessionCriticalRoles } from '../../../../lib/platform-api/succession';
import {
  useNineBoxGrid,
  useNineBoxDashboardKpis,
  useNineBoxListCalibrations,
  useNineBoxBenchStrength,
  useNineBoxEmployeeDetail,
  useNineBoxCreateCalibration,
  isNineboxForbiddenError,
  invalidateNineboxPlatformReads,
} from '../../../../lib/platform-api/ninebox';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, KpiCardSkeleton, PageHeader, Skeleton } from '../../../../components';
import { toast } from '../../../../lib/toast';
import { NineBoxGrid } from './nine-box-grid';
import { CalibrationModal } from './calibration-modal';
import { NineBoxKpis } from './nine-box-kpis';
import { EmployeeDetailCard } from './employee-detail-card';
import { BenchStrengthCard } from './bench-strength-card';
import { CalibrationSessionsList } from './calibration-sessions-list';
import { AutoPlanCard } from './auto-plan-card';

const PERIOD = new Date().getFullYear().toString();

function GridIcon() {
  return (
    <svg className="size-8" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <line x1="9" y1="3" x2="9" y2="21" />
      <line x1="15" y1="3" x2="15" y2="21" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="3" y1="15" x2="21" y2="15" />
    </svg>
  );
}

export default function NineBoxPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [calibrationSessionId, setCalibrationSessionId] = useState<string | null>(null);

  const gridQ = useNineBoxGrid(PERIOD);
  const kpisQ = useNineBoxDashboardKpis(PERIOD);

  // listCalibrations is org-governance (slice-7a): narrow-scope users (committee
  // leaders) can still reach this page via 'ninebox' read but get a FORBIDDEN
  // here. Treat that as "no calibration sessions visible" — the wrapper leaves
  // the 403 as a (retry-disabled) error on both the tRPC and C# paths, and
  // isNineboxForbiddenError normalizes it so the list falls back to an empty
  // state, never a crash.
  const sessionsQ = useNineBoxListCalibrations();
  const sessionsForbidden = isNineboxForbiddenError(sessionsQ.error);

  const startCalibration = useNineBoxCreateCalibration({
    onSuccess: (session) => {
      setCalibrationSessionId(session.id);
      sessionsQ.refetch();
      // Cutover parity: refresh the C# platform-api nine-box reads. No-op under tRPC.
      invalidateNineboxPlatformReads(queryClient);
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });
  useNineBoxBenchStrength(PERIOD);
  const successionQ = useSuccessionCriticalRoles({});
  const detailQ = useNineBoxEmployeeDetail(selectedUserId, PERIOD);

  const grid = gridQ.data?.grid ?? {};
  const total = gridQ.data?.totalEvaluations ?? 0;
  const dist = kpisQ.data?.distribution ?? {};

  const allPeople = useMemo(() => Object.values(grid).flat(), [grid]);

  const highPotentialCount = (dist['star'] ?? 0) + (dist['high_potential'] ?? 0) + (dist['enigma'] ?? 0);
  const atRiskCount = (dist['risk'] ?? 0) + (dist['underperformer'] ?? 0);
  const avgConfidence =
    allPeople.length > 0
      ? Math.round((allPeople.reduce((s, e) => s + (e.confidence ?? 0), 0) / allPeople.length) * 100)
      : 0;

  // Auto-select first person when grid loads
  if (!selectedUserId && allPeople.length > 0) {
    setSelectedUserId(allPeople[0].user.id);
  }

  const isLoading = gridQ.isLoading || kpisQ.isLoading;
  const loadError = gridQ.error ?? kpisQ.error;

  // The header (h1 + action) stays on screen in every state; only the body switches.
  let body: ReactNode;
  if (isLoading) {
    body = (
      <div aria-busy="true">
        <span className="sr-only">{t.common.loadingContent}</span>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <KpiCardSkeleton key={i} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-[420px] rounded-xl" />
          <Skeleton className="h-[420px] rounded-xl" />
        </div>
      </div>
    );
  } else if (gridQ.isError || kpisQ.isError) {
    body = (
      <ErrorState
        title={t.nineBox.loadError}
        error={loadError}
        onRetry={() => {
          gridQ.refetch();
          kpisQ.refetch();
        }}
      />
    );
  } else if (total === 0) {
    body = (
      <EmptyState
        icon={<GridIcon />}
        title={t.nineBox.noEvaluations}
        description={t.nineBox.noEvaluationsDesc}
        action={{ label: t.nineBox.goToPerformance, href: '/people/performance', variant: 'secondary' }}
      />
    );
  } else {
    body = (
      <>
        <NineBoxKpis
          total={total}
          highPotentialCount={highPotentialCount}
          atRiskCount={atRiskCount}
          avgConfidence={avgConfidence}
          period={PERIOD}
        />

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[7fr_5fr]">
          <NineBoxGrid
            grid={grid}
            allPeople={allPeople}
            selectedUserId={selectedUserId}
            onSelectUser={setSelectedUserId}
            period={PERIOD}
          />
          <div className="flex flex-col gap-4">
            <EmployeeDetailCard
              detail={detailQ.data?.evaluation}
              history={detailQ.data?.history ?? []}
              isLoading={detailQ.isLoading}
              error={detailQ.isError ? detailQ.error : null}
              onRetry={() => detailQ.refetch()}
            />
            <BenchStrengthCard
              roles={successionQ.data ?? []}
              isLoading={successionQ.isLoading}
              error={successionQ.isError ? successionQ.error : null}
              onRetry={() => successionQ.refetch()}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CalibrationSessionsList
            sessions={sessionsForbidden ? [] : (sessionsQ.data ?? [])}
            isLoading={sessionsQ.isLoading}
            error={sessionsQ.isError && !sessionsForbidden ? sessionsQ.error : null}
            onRetry={() => sessionsQ.refetch()}
            onManage={(id) => setCalibrationSessionId(id)}
          />
          <AutoPlanCard />
        </div>
      </>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <PageHeader
        title={t.nineBox.title}
        description={formatMessage(t.nineBox.pageDescription, { period: PERIOD })}
        actions={
          !isLoading &&
          !loadError &&
          total > 0 && (
            <Button
              onClick={() => startCalibration.mutate({ period: PERIOD })}
              loading={startCalibration.isPending}
              loadingLabel={t.nineBox.creatingSession}
            >
              {t.nineBox.newCalibrationSession}
            </Button>
          )
        }
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6">{body}</div>

      {calibrationSessionId && (
        <CalibrationModal
          sessionId={calibrationSessionId}
          period={PERIOD}
          onClose={() => {
            setCalibrationSessionId(null);
            kpisQ.refetch();
          }}
        />
      )}
    </div>
  );
}
