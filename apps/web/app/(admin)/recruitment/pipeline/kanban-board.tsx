'use client';

import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { KanbanCard } from './kanban-card';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';

interface KanbanBoardProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  onReject: (applicationId: string, reason: string) => void;
  isMoving: boolean;
}

const HEADER_COLORS = [
  'bg-[#E8E5F0]',
  'bg-[#D4CFE5]',
  'bg-[#C0B8D8]',
  'bg-[#ACA2CC]',
  'bg-[#988CBF]',
  'bg-[#8476B3]',
  'bg-[#7B6BAA]',
  'bg-[#6B5B9A]',
];

export function KanbanBoard({ stages, onMove, onReject, isMoving }: KanbanBoardProps) {
  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    if (result.source.droppableId === result.destination.droppableId) return;

    const applicationId = result.draggableId;
    const toStageId = result.destination.droppableId;
    onMove(applicationId, toStageId);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-3 h-full">
        {stages.map((stage, idx) => (
          <div
            key={stage.id}
            className="min-w-[260px] max-w-[260px] flex flex-col bg-[#F0EEF5]/50 rounded-xl overflow-hidden"
          >
            {/* Column Header */}
            <div className={`flex items-center justify-between px-3 py-3 shrink-0 ${HEADER_COLORS[idx % HEADER_COLORS.length]}`}>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-[#1F114C]">{stage.name}</span>
                <span className="bg-[#1F114C] text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {stage.count}
                </span>
              </div>
              {stage.slaHours && (
                <span className="text-[9px] text-[#8B8B8B]">{stage.slaHours}h SLA</span>
              )}
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
        ))}
      </div>
    </DragDropContext>
  );
}
