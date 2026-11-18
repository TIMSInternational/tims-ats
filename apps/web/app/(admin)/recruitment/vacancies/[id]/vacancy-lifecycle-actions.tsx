'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { usePermissions } from '../../../../../lib/permissions';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import type { VacancyDetail } from '../../../../../lib/trpc-types';
import { FreezeVacancyConfirm } from '../freeze-vacancy-confirm';
import { ResumeVacancyConfirm } from '../resume-vacancy-confirm';
import { EditVacancyDrawer } from './edit-vacancy-drawer';
import { isVacancyEditable } from './edit-vacancy-form';
import { Button } from '../../../../../components';

interface VacancyLifecycleActionsProps {
  vacancy: VacancyDetail;
}

/**
 * Vacancy detail header actions: "Editar" (vacancy.update, vacancy:update, editable statuses only),
 * "Congelar" (published vacancies, vacancy:update) and "Reanudar" (frozen vacancies, vacancy:publish).
 * The server enforces the same gates and status rules.
 */
export function VacancyLifecycleActions({ vacancy: v }: VacancyLifecycleActionsProps) {
  const { t } = useI18n();
  const { can } = usePermissions();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'freeze' | 'resume' | null>(null);

  const refresh = () => {
    utils.vacancy.getById.invalidate({ id: v.id });
    utils.vacancy.list.invalidate();
    utils.vacancy.getDashboardKpis.invalidate();
  };

  const freeze = trpc.vacancy.freeze.useMutation({
    onSuccess: () => {
      refresh();
      setConfirm(null);
      toast(t.vacancies.frozen, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      if (err.data?.code === 'CONFLICT') {
        refresh();
        setConfirm(null);
      }
    },
  });

  const resume = trpc.vacancy.resume.useMutation({
    onSuccess: () => {
      refresh();
      setConfirm(null);
      toast(t.vacancies.resumed, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
      if (err.data?.code === 'CONFLICT') {
        refresh();
        setConfirm(null);
      }
    },
  });

  const canEdit = isVacancyEditable(v.status) && can('vacancy', 'update');
  const canFreeze = v.status === 'published' && can('vacancy', 'update');
  const canResume = v.status === 'frozen' && can('vacancy', 'publish');

  return (
    <>
      {/* Secondary actions first; "Reanudar" is the frozen vacancy's one primary, so it trails. */}
      {canEdit && (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          {t.vacancies.editVacancy}
        </Button>
      )}
      {canFreeze && (
        <Button variant="secondary" onClick={() => setConfirm('freeze')}>
          {t.vacancies.freezeVacancy}
        </Button>
      )}
      {canResume && <Button onClick={() => setConfirm('resume')}>{t.vacancies.resumeVacancy}</Button>}

      {editing && (
        <EditVacancyDrawer vacancyId={v.id} vacancyStatus={v.status} vacancy={v} onClose={() => setEditing(false)} />
      )}
      {confirm === 'freeze' && (
        <FreezeVacancyConfirm
          vacancyTitle={v.title}
          onConfirm={() => freeze.mutate({ id: v.id })}
          onClose={() => setConfirm(null)}
          isPending={freeze.isPending}
        />
      )}
      {confirm === 'resume' && (
        <ResumeVacancyConfirm
          vacancyTitle={v.title}
          onConfirm={() => resume.mutate({ id: v.id })}
          onClose={() => setConfirm(null)}
          isPending={resume.isPending}
        />
      )}
    </>
  );
}
