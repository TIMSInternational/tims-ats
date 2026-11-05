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

interface VacancyLifecycleActionsProps {
  vacancy: VacancyDetail;
}

const secondaryBtn =
  'flex items-center gap-1.5 border border-[#EDEDED] text-[#1F114C] px-3 h-8 rounded-lg text-[12px] font-medium hover:bg-[#F6F6F6] transition';

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
      {canResume && (
        <button
          type="button"
          onClick={() => setConfirm('resume')}
          className="flex items-center gap-1.5 bg-[#1F114C] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#2a1a5c] transition"
        >
          {t.vacancies.resumeVacancy}
        </button>
      )}
      {canEdit && (
        <button type="button" onClick={() => setEditing(true)} className={secondaryBtn}>
          {t.vacancies.editVacancy}
        </button>
      )}
      {canFreeze && (
        <button
          type="button"
          onClick={() => setConfirm('freeze')}
          className="flex items-center gap-1.5 border border-purple-200 text-purple-600 px-3 h-8 rounded-lg text-[12px] font-medium hover:bg-purple-50 transition"
        >
          {t.vacancies.freezeVacancy}
        </button>
      )}

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
