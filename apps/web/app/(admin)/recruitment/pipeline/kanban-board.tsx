'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { KanbanCard } from './kanban-card';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';

interface KanbanBoardProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  onReject: (applicationId: string, reason: string) => void;
}

/** Progressive purple gradient — lighter to darker, left to right */
const HEADER_COLORS: Array<{ bg: string; text: string; badge: string; badgeText: string }> = [
  { bg: 'bg-[#E8E5F0]', text: 'text-[#1F114C]', badge: 'bg-[#1F114C]', badgeText: 'text-white' },
  { bg: 'bg-[#D4CFE5]', text: 'text-[#1F114C]', badge: 'bg-[#1F114C]', badgeText: 'text-white' },
  { bg: 'bg-[#B8AED4]', text: 'text-white',      badge: 'bg-white',     badgeText: 'text-[#1F114C]' },
  { bg: 'bg-[#7B6BAA]', text: 'text-white',      badge: 'bg-white',     badgeText: 'text-[#1F114C]' },
  { bg: 'bg-[#5C4B99]', text: 'text-white',      badge: 'bg-white',     badgeText: 'text-[#1F114C]' },
  { bg: 'bg-[#1F114C]', text: 'text-white',      badge: 'bg-white',     badgeText: 'text-[#1F114C]' },
];

function getHeaderStyle(idx: number) {
  return HEADER_COLORS[Math.min(idx, HEADER_COLORS.length - 1)];
}

export function KanbanBoard({ stages, onMove }: KanbanBoardProps) {
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.source.droppableId === result.destination.droppableId) return;
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

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="relative h-full">
        <div ref={scrollRef} className="flex gap-3 h-full overflow-x-auto overflow-y-hidden">
          {stages.map((stage, idx) => {
            const style = getHeaderStyle(idx);
            const isDark = idx >= 2;

            // Count overdue applications in this stage — time-in-CURRENT-stage,
            // not time since the original application (matches kanban-card.tsx).
            // Precise hours, not floored days*24, so sub-24h SLAs can trigger same-day.
            const overdueCount = stage.slaHours
              ? stage.applications.filter((app) => {
                  const hoursInStage = (Date.now() - new Date(app.enteredStageAt).getTime()) / 3600000;
                  return hoursInStage > stage.slaHours!;
                }).length
              : 0;

            return (
              <div
                key={stage.id}
                className="min-w-[240px] max-w-[240px] flex flex-col bg-[#F0EEF5]/50 rounded-xl overflow-hidden"
              >
                {/* Column Header */}
                <div className={`flex items-center justify-between px-3 py-3 shrink-0 ${style.bg}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[13px] font-semibold ${style.text}`}>
                      {stage.name}
                    </span>
                    <span className={`${style.badge} ${style.badgeText} text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center`}>
                      {stage.count}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {overdueCount > 0 && (
                      <span className="text-[10px] text-[#DD0C15] font-medium bg-red-50 px-1.5 py-0.5 rounded">
                        {overdueCount} SLA!
                      </span>
                    )}
                    {stage.slaHours && overdueCount === 0 && (
                      <span className={`text-[9px] ${isDark ? 'text-white/60' : 'text-[#8B8B8B]'}`}>
                        {stage.slaHours}h SLA
                      </span>
                    )}
                    {/* Three-dot menu */}
                    <svg
                      className={`w-4 h-4 cursor-pointer ${isDark ? 'text-white/70' : 'text-[#8B8B8B]'}`}
                      fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"
                    >
                      <circle cx="12" cy="6" r="1" />
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="12" cy="18" r="1" />
                    </svg>
                  </div>
                </div>

                {/* Droppable Area */}
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] transition-colors ${
                        snapshot.isDraggingOver ? 'bg-[#1F114C]/5' : ''
                      }`}
                    >
                      {stage.applications.map((app, appIdx) => (
                        <Draggable key={app.id} draggableId={app.id} index={appIdx}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                            >
                              <KanbanCard
                                application={app}
                                isDragging={dragSnapshot.isDragging}
                                slaHours={stage.slaHours}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
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
