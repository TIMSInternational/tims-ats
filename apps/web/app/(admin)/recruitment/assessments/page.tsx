'use client';

import { useEffect, useState } from 'react';
import type { QuestionType, QuestionOption } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { EmptyState, Skeleton } from '../../../../components';
import { QuestionModal, type EditableQuestion } from './question-modal';

export default function AssessmentAuthoringPage() {
  const { t } = useI18n();
  const [typeId, setTypeId] = useState<string>('');
  const [editing, setEditing] = useState<EditableQuestion | null>(null);
  const [showModal, setShowModal] = useState(false);

  const types = trpc.assessment.listTypes.useQuery();

  useEffect(() => {
    if (!typeId && types.data && types.data.length > 0) setTypeId(types.data[0].id);
  }, [typeId, types.data]);

  const questions = trpc.assessment.listQuestions.useQuery(
    { assessmentTypeId: typeId, includeInactive: true },
    { enabled: !!typeId },
  );

  const utils = trpc.useUtils();
  const refresh = () => utils.assessment.listQuestions.invalidate();

  const deleteM = trpc.assessment.deleteQuestion.useMutation({
    onSuccess: () => {
      toast(t.assessments.deleted, { type: 'success' });
      refresh();
    },
    onError: (err) =>
      toast(
        err.message === 'question_has_responses'
          ? t.assessments.cannotDeleteWithResponses
          : err.message,
        { type: 'error' },
      ),
  });

  const openCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (q: EditableQuestion) => {
    setEditing(q);
    setShowModal(true);
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t.assessments.confirmDelete)) deleteM.mutate({ id });
  };

  const onSaved = () => {
    setShowModal(false);
    setEditing(null);
    refresh();
  };

  const items = (questions.data ?? []).map(
    (q): EditableQuestion => ({
      id: q.id,
      type: q.type as QuestionType,
      prompt: q.prompt,
      options: (q.options as unknown as QuestionOption[]) ?? [],
      correctOptionIds: (q.correctOptionIds as unknown as string[]) ?? [],
      points: q.points,
      order: q.order,
      isActive: q.isActive,
    }),
  );

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex items-start justify-between mb-5 flex-shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-[#1F114C]">{t.assessments.title}</h1>
          <p className="text-sm text-[#8B8B8B] mt-0.5">{t.assessments.subtitle}</p>
        </div>
        {typeId && (
          <button
            onClick={openCreate}
            className="h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition"
          >
            {t.assessments.addQuestion}
          </button>
        )}
      </div>

      {/* Type selector */}
      <div className="mb-5 max-w-md flex-shrink-0">
        <label className="block text-xs font-medium text-[#8B8B8B] mb-1.5">{t.assessments.selectType}</label>
        {types.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : types.data && types.data.length > 0 ? (
          <select
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
          >
            {types.data.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-[#8B8B8B]">{t.assessments.noTypes}</p>
        )}
      </div>

      {/* Question list */}
      <div className="flex-1 overflow-auto">
        {!typeId ? null : questions.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<span className="text-3xl">📝</span>}
            message={t.assessments.noQuestions}
            description={t.assessments.noQuestionsDesc}
            action={{ label: t.assessments.addQuestion, onClick: openCreate }}
          />
        ) : (
          <ul className="space-y-2">
            {items.map((q) => (
              <li
                key={q.id}
                className="flex items-start justify-between gap-4 p-4 rounded-xl border border-[#EDEDED] bg-white"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#F0EDF7] text-[#1F114C]">
                      {t.assessments.types[q.type]}
                    </span>
                    <span className="text-[11px] text-[#8B8B8B]">{q.points} pts</span>
                    {!q.isActive && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#FBE9E9] text-[#B42318]">
                        {t.assessments.inactive}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-[#1A1A1A] truncate">{q.prompt}</p>
                  {q.type !== 'free_text' && (
                    <p className="text-xs text-[#8B8B8B] mt-0.5">
                      {q.options.length} {t.assessments.fields.options.toLowerCase()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => openEdit(q)}
                    className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#585858] hover:bg-[#F5F5F5]"
                  >
                    {t.assessments.editTitle}
                  </button>
                  <button
                    onClick={() => handleDelete(q.id)}
                    className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs font-medium text-[#B42318] hover:bg-[#FBE9E9]"
                  >
                    {t.assessments.delete}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showModal && typeId && (
        <QuestionModal
          assessmentTypeId={typeId}
          question={editing}
          onClose={() => {
            setShowModal(false);
            setEditing(null);
          }}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
