'use client';

import { useI18n } from '../../../../lib/i18n';
import { Menu, type MenuEntry } from '../../../../components/menu';
import { buttonClasses } from '../../../../components/button-styles';
import type { InterviewListItem } from '../../../../lib/trpc-types';
import { isVideoInterview, ROOM_STATUSES } from './[id]/room/interview-mode';
import { canCancelInterview, canMarkNoShow } from './interview-status';
import { canRescheduleInterview } from './interview-reschedule';

export interface InterviewRowHandlers {
  onCancel?: (id: string) => void;
  isCancelling: boolean;
  onMarkNoShow?: (id: string) => void;
  onReschedule?: (iv: InterviewListItem) => void;
  onManageEvaluators?: (id: string) => void;
  onStartAiScreen: (id: string) => void;
  aiScreenEnabled: boolean;
  aiScreenError?: boolean;
}

interface InterviewRowActionsProps extends InterviewRowHandlers {
  iv: InterviewListItem;
  now: Date;
  /** Stretch the room link (phone list items). */
  fullWidth?: boolean;
}

/** The secondary row commands, in the order of a "Más acciones" menu; the destructive one last. */
function menuItems(t: ReturnType<typeof useI18n>['t'], p: InterviewRowActionsProps): MenuEntry[] {
  const { iv, now } = p;
  const items: MenuEntry[] = [];
  if (p.onManageEvaluators) {
    const open = p.onManageEvaluators;
    items.push({ key: 'evaluators', label: t.interviews.manageEvaluatorsMenu, onSelect: () => open(iv.id) });
  }
  if (p.onReschedule && canRescheduleInterview(iv)) {
    const open = p.onReschedule;
    items.push({ key: 'reschedule', label: t.interviews.rescheduleMenu, onSelect: () => open(iv) });
  }
  if (p.aiScreenEnabled || p.aiScreenError) {
    items.push({
      key: 'ai-screen',
      // A failed entitlement read disables the item; say so in the label rather than leaving it silent.
      label: p.aiScreenEnabled ? t.interviews.startAiScreen : t.interviews.startAiScreenUnavailable,
      disabled: !p.aiScreenEnabled,
      onSelect: () => p.onStartAiScreen(iv.id),
    });
  }
  if (p.onMarkNoShow && canMarkNoShow(iv, now)) {
    const open = p.onMarkNoShow;
    items.push({ key: 'no-show', label: t.interviews.markNoShowMenu, onSelect: () => open(iv.id) });
  }
  if (p.onCancel && canCancelInterview(iv, now)) {
    const open = p.onCancel;
    if (items.length > 0) items.push({ key: 'sep', type: 'separator' });
    items.push({
      key: 'cancel',
      label: t.interviews.cancelInterviewMenu,
      destructive: true,
      disabled: p.isCancelling,
      onSelect: () => open(iv.id),
    });
  }
  return items;
}

/**
 * The row's one visible action is the room ("Calificar" / "Unirse"); everything else sits in a "Más
 * acciones" menu so the action people come for is never pushed out of the table (layout.md › Visual
 * hierarchy, toolbars.md: "Add a More menu").
 */
export function InterviewRowActions(props: InterviewRowActionsProps) {
  const { t } = useI18n();
  const { iv, fullWidth = false } = props;
  const items = menuItems(t, props);
  const name = `${iv.candidate.firstName} ${iv.candidate.lastName}`;
  const joins = isVideoInterview(iv) && iv.status !== 'completed';

  return (
    <div className={`flex items-center gap-1 whitespace-nowrap ${fullWidth ? 'w-full' : 'justify-end'}`}>
      {ROOM_STATUSES.has(iv.status) && (
        // Plain <a>, not next/link: the room needs a FULL document load so the browser receives the room
        // route's CSP (Daily call object). A soft navigation keeps this page's stricter CSP and the call fails.
        // Labelled "Join" only for a video interview not yet completed; every other room opens on the
        // scoring stage, so it is labelled "Score".
        <a
          href={`/recruitment/interviews/${iv.id}/room`}
          className={buttonClasses({
            variant: 'secondary',
            size: 'sm',
            fullWidth,
            className: fullWidth ? 'flex-1' : '',
          })}
        >
          <svg
            className="size-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            {joins ? (
              <path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z" />
            ) : (
              <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
            )}
          </svg>
          {joins ? t.interviews.joinMeeting : t.interviews.scoreInterview}
        </a>
      )}
      {items.length > 0 && <Menu items={items} label={t.interviews.rowMoreActions.replace('{name}', name)} />}
    </div>
  );
}
