'use client';

import { CHOICE_INPUT_CLASSES } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';

interface ChecklistItem {
  key: string;
  label: string;
}

export function coerceChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v))
    .map((v) => ({ key: typeof v.key === 'string' ? v.key : '', label: typeof v.label === 'string' ? v.label : '' }))
    .filter((item) => item.key !== '');
}

function isItemComplete(progress: unknown, stageId: string, itemKey: string): boolean {
  if (!progress || typeof progress !== 'object' || Array.isArray(progress)) return false;
  const stageProgress = (progress as Record<string, unknown>)[stageId];
  if (!stageProgress || typeof stageProgress !== 'object' || Array.isArray(stageProgress)) return false;
  const entry = (stageProgress as Record<string, unknown>)[itemKey];
  return !!entry && typeof entry === 'object' && (entry as { completed?: unknown }).completed === true;
}

interface KanbanCardChecklistProps {
  applicationId: string;
  stageId: string;
  items: ChecklistItem[];
  // Prisma.JsonValue: only the current stage's completion map is ever written (Sprint 1.3 Task 1).
  progress: unknown;
  disabled: boolean;
  onToggle?: (applicationId: string, stageId: string, itemKey: string, completed: boolean) => void;
}

/** The current stage's checklist on a kanban card. */
export function KanbanCardChecklist({
  applicationId,
  stageId,
  items,
  progress,
  disabled,
  onToggle,
}: KanbanCardChecklistProps) {
  const { t } = useI18n();
  const headingId = `checklist-${applicationId}`;
  return (
    // stopPropagation on mousedown so a checkbox click never starts a drag on the
    // @hello-pangea/dnd handle wrapping this whole card.
    <div
      role="group"
      aria-labelledby={headingId}
      className="mt-2 pt-2 border-t border-border space-y-0.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <p id={headingId} className="text-caption font-semibold text-secondary">
        {t.pipeline.checklistTitle}
      </p>
      {items.map((item) => {
        const completed = isItemComplete(progress, stageId, item.key);
        return (
          <label key={item.key} className="flex min-h-7 items-center gap-2 cursor-pointer pointer-coarse:min-h-11">
            <input
              type="checkbox"
              checked={completed}
              disabled={disabled}
              onChange={(e) => onToggle?.(applicationId, stageId, item.key, e.target.checked)}
              className={CHOICE_INPUT_CLASSES}
            />
            <span className={`text-caption ${completed ? 'text-muted line-through' : 'text-primary'}`}>
              {item.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}
