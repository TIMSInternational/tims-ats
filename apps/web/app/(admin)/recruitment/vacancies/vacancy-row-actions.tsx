'use client';

import { formatMessage, useI18n } from '../../../../lib/i18n';
import { Menu, type MenuEntry } from '../../../../components';
import { usePermissions } from '../../../../lib/permissions';
import type { VacancyListItem } from '../../../../lib/trpc-types';

interface VacancyRowActionsProps {
  vacancy: VacancyListItem;
  /** The row whose "Duplicar" is in flight: its item is disabled and reads "Duplicando…". */
  isDuplicating: boolean;
  onDuplicate: (id: string) => void;
  onClose: (v: VacancyListItem) => void;
  onFreeze: (v: VacancyListItem) => void;
  onResume?: (v: VacancyListItem) => void;
}

/**
 * One "Más acciones" menu per row (pull-down-buttons.md): Duplicar, Congelar… / Reanudar…, then the destructive
 * "Cerrar vacante…" after a separator. Items that open a confirmation end in "…". The title link is the way in.
 */
export function VacancyRowActions({
  vacancy: v,
  isDuplicating,
  onDuplicate,
  onClose,
  onFreeze,
  onResume,
}: VacancyRowActionsProps) {
  const { t } = useI18n();
  const { can } = usePermissions();

  const items: MenuEntry[] = [
    {
      key: 'duplicate',
      label: isDuplicating ? t.vacancies.duplicating : t.vacancies.duplicateVacancy,
      disabled: isDuplicating,
      onSelect: () => onDuplicate(v.id),
    },
  ];
  // A-08: "Congelar" has a way back ("Reanudar" on the frozen row and on the detail page).
  if (v.status === 'published') {
    items.push({ key: 'freeze', label: t.vacancies.freezeVacancyMenu, onSelect: () => onFreeze(v) });
  }
  if (v.status === 'frozen' && onResume && can('vacancy', 'publish')) {
    items.push({ key: 'resume', label: t.vacancies.resumeVacancyMenu, onSelect: () => onResume(v) });
  }
  if (v.status !== 'closed' && v.status !== 'frozen') {
    items.push({ key: 'sep', type: 'separator' });
    items.push({ key: 'close', label: t.vacancies.closeVacancyMenu, destructive: true, onSelect: () => onClose(v) });
  }

  return <Menu items={items} label={formatMessage(t.vacancies.rowActions, { title: v.title })} />;
}
