'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DragStart,
  type DragUpdate,
  type DropResult,
  type ResponderProvided,
} from '@hello-pangea/dnd';
import { KanbanCard } from './kanban-card';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { isActionableApplication, stageOverdueCount, type ScheduleRequest } from './pipeline-actions';
import { PipelineStageHeader } from './pipeline-stage-header';

interface KanbanBoardProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  /** Opens the reject modal for one application. Omitted when the user lacks pipeline:update. */
  onReject?: (applicationId: string, candidateName: string) => void;
  /** Opens the prefilled schedule form (A-10). Omitted when the user lacks interview:create. */
  onSchedule?: (request: ScheduleRequest) => void;
  onToggleChecklistItem?: (applicationId: string, stageId: string, itemKey: string, completed: boolean) => void;
}

export function KanbanBoard({ stages, onMove, onReject, onSchedule, onToggleChecklistItem }: KanbanBoardProps) {
  const { t } = useI18n();
  const p = t.pipeline;

  // Drag announcements in the UI language, naming the candidate and the stage (drag-and-drop.md › Providing
  // feedback). The library's defaults are English and only give positions.
  const stageName = (id: string | undefined) => stages.find((stage) => stage.id === id)?.name ?? '';
  const candidateName = (applicationId: string) => {
    const app = stages.flatMap((stage) => stage.applications).find((a) => a.id === applicationId);
    return app ? `${app.candidate.firstName} ${app.candidate.lastName}` : '';
  };

  const handleDragStart = (start: DragStart, provided: ResponderProvided) => {
    provided.announce(
      formatMessage(p.dndLifted, {
        name: candidateName(start.draggableId),
        stage: stageName(start.source.droppableId),
      }),
    );
  };

  const handleDragUpdate = (update: DragUpdate, provided: ResponderProvided) => {
    provided.announce(
      update.destination
        ? formatMessage(p.dndOver, { stage: stageName(update.destination.droppableId) })
        : p.dndOutside,
    );
  };

  const handleDragEnd = (result: DropResult, provided: ResponderProvided) => {
    const name = candidateName(result.draggableId);
    const from = stageName(result.source.droppableId);
    if (result.reason === 'CANCEL') {
      provided.announce(formatMessage(p.dndCancelled, { name, stage: from }));
      return;
    }
    if (!result.destination || result.source.droppableId === result.destination.droppableId) {
      provided.announce(formatMessage(p.dndReturned, { name, stage: from }));
      return;
    }
    provided.announce(formatMessage(p.dndDropped, { name, stage: stageName(result.destination.droppableId) }));
    onMove(result.draggableId, result.destination.droppableId);
  };

  // Right-edge fade cue: shows only while there are more columns off-screen
  // to the right, and disappears once the board is scrolled to its end (or
  // never appears at all if every column already fits). The board's OWN
  // horizontal scroll container is this div — the parent page's
  // `overflow-x-auto` wrapper only clips it, the scroll math below reads
  // scrollWidth/clientWidth/scrollLeft off this element directly.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollRight(el.scrollWidth > el.clientWidth + el.scrollLeft + 1);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => updateScrollState();
    el.addEventListener('scroll', onScroll);
    window.addEventListener('resize', updateScrollState);
    return () => {
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', updateScrollState);
    };
    // Re-check whenever the column set changes (stage count/content affects scrollWidth).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages, updateScrollState]);

  const moveTargets = stages.map((stage) => ({ id: stage.id, name: stage.name }));

  return (
    <DragDropContext
      onDragStart={handleDragStart}
      onDragUpdate={handleDragUpdate}
      onDragEnd={handleDragEnd}
      dragHandleUsageInstructions={p.dndInstructions}
    >
      <div className="relative h-full">
        <div ref={scrollRef} className="flex gap-3 h-full overflow-x-auto overflow-y-hidden">
          {stages.map((stage, idx) => {
            const headingId = `stage-${stage.id}`;
            return (
              <section
                key={stage.id}
                aria-labelledby={headingId}
                className="w-60 shrink-0 flex flex-col bg-surface rounded-xl overflow-hidden"
              >
                <PipelineStageHeader
                  headingId={headingId}
                  name={stage.name}
                  index={idx}
                  shown={stage.applications.length}
                  total={stage.count}
                  slaHours={stage.slaHours}
                  overdueCount={stageOverdueCount(stage)}
                  className="border-b border-border"
                />

                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`relative flex-1 overflow-y-auto p-2 space-y-2 min-h-25 rounded-b-xl transition-colors ${
                        snapshot.isDraggingOver
                          ? 'bg-brand-tint outline-2 outline-dashed -outline-offset-4 outline-brand/60'
                          : ''
                      }`}
                    >
                      {stage.applications.length === 0 && !snapshot.isDraggingOver && (
                        <p className="px-2 py-6 text-center text-callout text-muted">{p.emptyStage}</p>
                      )}
                      {stage.applications.map((app, appIdx) => {
                        // A rejected or hired card (Rechazados / Todos views) is read-only: no drag, no actions.
                        const actionable = isActionableApplication(app);
                        const name = `${app.candidate.firstName} ${app.candidate.lastName}`;
                        return (
                          <Draggable key={app.id} draggableId={app.id} index={appIdx} isDragDisabled={!actionable}>
                            {(dragProvided, dragSnapshot) => (
                              // The library makes this wrapper role="button"; a button's children are
                              // presentational, which would hide the card's links and buttons from screen
                              // readers. A named group keeps them reachable; tabIndex, the usage
                              // instructions and the keyboard drag stay the library's.
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                role="group"
                                aria-label={name}
                                aria-roledescription={actionable ? p.dndCardRole : undefined}
                              >
                                <KanbanCard
                                  application={app}
                                  isDragging={dragSnapshot.isDragging}
                                  actionable={actionable}
                                  slaHours={stage.slaHours}
                                  stageId={stage.id}
                                  checklist={stage.checklist}
                                  onToggleChecklistItem={onToggleChecklistItem}
                                  onReject={onReject && actionable ? () => onReject(app.id, name) : undefined}
                                  onSchedule={
                                    onSchedule && actionable
                                      ? () =>
                                          onSchedule({
                                            applicationId: app.id,
                                            candidateId: app.candidate.id,
                                            candidateName: name,
                                          })
                                      : undefined
                                  }
                                  moveTargets={
                                    onReject && actionable
                                      ? moveTargets.filter((target) => target.id !== stage.id)
                                      : undefined
                                  }
                                  onMoveTo={(toStageId) => onMove(app.id, toStageId)}
                                />
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </section>
            );
          })}
        </div>

        {/* Scroll-affordance cue: a right-edge fade that hints more columns
            are off-screen. Purely visual (no text), so no i18n keys needed. */}
        {canScrollRight && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-[var(--content-bg-panel)] to-transparent"
            aria-hidden="true"
          />
        )}
      </div>
    </DragDropContext>
  );
}
