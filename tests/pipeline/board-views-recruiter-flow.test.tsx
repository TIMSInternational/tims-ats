import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const m = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (...args: unknown[]) => m.toast(...args) }));

import { KanbanCard } from '../../apps/web/app/(admin)/recruitment/pipeline/kanban-card';
import { PipelineTableView } from '../../apps/web/app/(admin)/recruitment/pipeline/pipeline-table-view';
import { PipelineListView } from '../../apps/web/app/(admin)/recruitment/pipeline/pipeline-list-view';
import type { PipelineStageWithApps } from '../../apps/web/lib/trpc-types';

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY - 3_600_000).toISOString();

function app(id: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    status,
    source: 'portal',
    appliedAt: iso(30),
    enteredStageAt: iso(2),
    rejectedAt: null,
    rejectedReason: null,
    checklistProgress: null,
    candidate: {
      id: `cand-${id}`,
      firstName: id === 'a1' ? 'Ana' : id === 'a2' ? 'Luis' : 'Eva',
      lastName: 'Mora',
      email: `${id}@example.test`,
      avatar: null,
      currentTitle: null,
      currentCompany: null,
      fitScores: [{ overallScore: 72, isPartial: false }],
    },
    ...extra,
  };
}

function stages(...apps: Array<ReturnType<typeof app>>): PipelineStageWithApps[] {
  return [
    { id: 's1', name: 'Preselección', order: 0, slaHours: 120, checklist: null, isDefault: true, count: apps.length, applications: apps },
    { id: 's2', name: 'Entrevista final', order: 1, slaHours: 168, checklist: null, isDefault: false, count: 0, applications: [] },
  ] as unknown as PipelineStageWithApps[];
}

beforeEach(() => vi.clearAllMocks());

describe('kanban card', () => {
  it('shows days in the CURRENT stage, with the application date in the tooltip (A-23)', () => {
    render(<KanbanCard application={app('a1', 'active')} isDragging={false} stageId="s1" />);
    const label = screen.getByText('2 días en etapa');
    expect(label.getAttribute('title')).toMatch(/^Postulación: /);
    expect(screen.queryByText('30 días')).toBeNull();
  });

  it('a rejected card says when and keeps the reason in the tooltip (A-05)', () => {
    const rejected = app('a1', 'rejected', { rejectedAt: '2026-11-05T15:00:00.000Z', rejectedReason: 'NO_SHOW: No se presentó' });
    render(<KanbanCard application={rejected} isDragging={false} stageId="s1" />);
    const pill = screen.getByText(/^Rechazado el /);
    expect(pill.getAttribute('title')).toBe(es.rejectCandidateModal.reasons.NO_SHOW);
    expect(screen.queryByText(/días en etapa/)).toBeNull();
  });

  it('schedules an interview from the card (A-10) and links the FIT badge to its detail (ideal-110)', () => {
    const onSchedule = vi.fn();
    render(<KanbanCard application={app('a1', 'active')} isDragging={false} stageId="s1" onSchedule={onSchedule} />);
    fireEvent.click(screen.getByRole('button', { name: es.pipeline.scheduleInterviewFor.replace('{name}', 'Ana Mora') }));
    expect(onSchedule).toHaveBeenCalledTimes(1);
    const fit = screen.getByRole('link', { name: es.pipeline.fitDetailLink.replace('{name}', 'Ana Mora') });
    expect(fit.getAttribute('href')).toBe('/recruitment/candidates/cand-a1?tab=tabFitGaps');
  });
});

describe('table view bulk actions (journeys-26)', () => {
  it('moves the selected active rows in one call, skipping rows already in the target stage', () => {
    const onBulkMove = vi.fn();
    render(
      <PipelineTableView
        stages={stages(app('a1', 'active'), app('a2', 'active'), app('a3', 'rejected'))}
        boardStatus="all"
        onMove={vi.fn()}
        onBulkMove={onBulkMove}
        onBulkReject={vi.fn()}
      />,
    );
    // A rejected row cannot be selected.
    expect(screen.queryByRole('checkbox', { name: es.pipeline.bulkSelectRow.replace('{name}', 'Eva Mora') })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: es.pipeline.bulkSelectAll }));
    const bar = screen.getByRole('region', { name: es.pipeline.bulkSelected });
    expect(within(bar).getByText(`2 ${es.pipeline.bulkSelected}`)).toBeTruthy();
    fireEvent.change(within(bar).getByLabelText(es.pipeline.bulkMoveTo), { target: { value: 's2' } });
    fireEvent.click(within(bar).getByRole('button', { name: es.pipeline.bulkMove }));
    expect(onBulkMove).toHaveBeenCalledWith(['a1', 'a2'], 's2');
  });

  it('hands the selection to the bulk reject modal', () => {
    const onBulkReject = vi.fn();
    render(<PipelineTableView stages={stages(app('a1', 'active'), app('a2', 'active'))} onMove={vi.fn()} onBulkReject={onBulkReject} />);
    fireEvent.click(screen.getByRole('checkbox', { name: es.pipeline.bulkSelectRow.replace('{name}', 'Luis Mora') }));
    fireEvent.click(screen.getByRole('button', { name: es.pipeline.bulkReject }));
    expect(onBulkReject).toHaveBeenCalledWith([{ id: 'a2', vacancyTitle: 'Luis Mora' }]);
  });

  it('tags the selected candidates (candidate.bulkTag)', () => {
    const onBulkTag = vi.fn();
    render(<PipelineTableView stages={stages(app('a1', 'active'), app('a2', 'active'))} onMove={vi.fn()} onBulkTag={onBulkTag} />);
    fireEvent.click(screen.getByRole('checkbox', { name: es.pipeline.bulkSelectAll }));
    fireEvent.change(screen.getByLabelText(es.pipeline.bulkTagLabel), { target: { value: '  Revisar títulos ' } });
    fireEvent.click(screen.getByRole('button', { name: es.pipeline.bulkTagAction }));
    expect(onBulkTag).toHaveBeenCalledWith(['cand-a1', 'cand-a2'], 'Revisar títulos');
  });

  it('has no selection column for a viewer without bulk actions', () => {
    render(<PipelineTableView stages={stages(app('a1', 'active'))} onMove={vi.fn()} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});

describe('list view (A-22)', () => {
  it('stacks each row below md and keeps the actions reachable; rejected rows have none', () => {
    const { container } = render(
      <PipelineListView stages={stages(app('a1', 'active'), app('a3', 'rejected'))} onMove={vi.fn()} onReject={vi.fn()} onSchedule={vi.fn()} />,
    );
    const rows = container.querySelectorAll('.divide-y > div');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.className).toContain('flex-col');
    expect(row(rows[0]!).getByRole('button', { name: es.pipeline.advance })).toBeTruthy();
    expect(row(rows[0]!).getByRole('button', { name: es.pipeline.scheduleInterviewFor.replace('{name}', 'Ana Mora') })).toBeTruthy();
    expect(row(rows[1]!).queryByRole('button')).toBeNull();
    expect(row(rows[1]!).getByText(es.pipeline.applicationStatus.rejected)).toBeTruthy();
  });
});

function row(el: Element) {
  return within(el as HTMLElement);
}
