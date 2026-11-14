'use client';

import { useEffect, useState } from 'react';
import type { QuestionType, QuestionOption } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
} from '../../../../components';
import { QuestionModal, type EditableQuestion } from './question-modal';
import { AssessmentTypeToolbar } from './assessment-type-toolbar';
import type { AssessmentTypeRow } from '../../../../lib/platform-api/assessment-types';

export default function AssessmentAuthoringPage() {
  const { t } = useI18n();
  const [typeId, setTypeId] = useState<string>('');
  const [editing, setEditing] = useState<EditableQuestion | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [deleting, setDeleting] = useState<EditableQuestion | null>(null);

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

  const selectedType = types.data?.find((tp) => tp.id === typeId) ?? null;
  const onTypeChanged = (row: AssessmentTypeRow) => {
    // A new/edited type becomes the selection; a deactivated one drops out of the active list.
    setTypeId(row.isActive ? row.id : '');
    void utils.assessment.listTypes.invalidate();
  };

  const deleteM = trpc.assessment.deleteQuestion.useMutation({
    onSuccess: () => {
      toast(t.assessments.deleted, { type: 'success' });
      refresh();
    },
    onError: (err) =>
      toast(err.message === 'question_has_responses' ? t.assessments.cannotDeleteWithResponses : err.message, {
        type: 'error',
      }),
  });

  const openCreate = () => {
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (q: EditableQuestion) => {
    setEditing(q);
    setShowModal(true);
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

  const hasTypes = !!types.data && types.data.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title={t.assessments.title}
        description={t.assessments.subtitle}
        actions={
          typeId ? (
            <Button variant="primary" onClick={openCreate}>
              {t.assessments.addQuestion}
            </Button>
          ) : undefined
        }
      />

      <div className="flex-1 overflow-auto px-4 py-5 md:px-6 md:py-6">
        {/* Type selector */}
        <div className="mb-6 max-w-md">
          {types.isLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : types.isError ? (
            <ErrorState onRetry={() => types.refetch()} />
          ) : hasTypes ? (
            <Field label={t.assessments.selectType} id="assessment-type-select">
              <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {types.data.map((tp) => (
                  <option key={tp.id} value={tp.id}>
                    {tp.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {!types.isLoading && !types.isError && !hasTypes && (
            <EmptyState
              icon={<QuizIcon />}
              title={t.assessments.typeAuthoring.emptyTitle}
              description={t.assessments.typeAuthoring.emptyCta}
            />
          )}
          <div className={hasTypes ? 'mt-3' : 'mt-3 flex justify-center'}>
            <AssessmentTypeToolbar
              selected={
                selectedType
                  ? {
                      id: selectedType.id,
                      name: selectedType.name,
                      description: selectedType.description,
                      duration: selectedType.duration,
                    }
                  : null
              }
              createVariant={hasTypes || types.isLoading ? 'secondary' : 'primary'}
              onChanged={onTypeChanged}
            />
          </div>
        </div>

        {/* Question list */}
        {!typeId ? null : questions.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">{t.common.loadingContent}</span>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : questions.isError ? (
          <ErrorState onRetry={() => questions.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<QuizIcon />}
            title={t.assessments.noQuestions}
            description={t.assessments.noQuestionsDesc}
            action={{ label: t.assessments.addQuestion, onClick: openCreate, variant: 'secondary' }}
          />
        ) : (
          <ul className="space-y-2">
            {items.map((q) => (
              <li
                key={q.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-white p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge tone="brand" icon="none">
                      {t.assessments.types[q.type]}
                    </StatusBadge>
                    <span className="text-caption text-secondary tabular-nums">
                      {formatMessage(t.assessments.pointsShort, { n: q.points })}
                    </span>
                    {!q.isActive && <StatusBadge tone="neutral">{t.assessments.inactive}</StatusBadge>}
                  </div>
                  <p className="truncate text-body text-primary">{q.prompt}</p>
                  {q.type !== 'free_text' && (
                    <p className="mt-0.5 text-callout text-secondary">
                      {formatMessage(t.assessments.optionCount, { n: q.options.length })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => openEdit(q)}>
                    {t.assessments.editTitle}
                  </Button>
                  <Button variant="destructive-secondary" size="sm" onClick={() => setDeleting(q)}>
                    {t.assessments.delete}
                  </Button>
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
      {deleting && (
        <ConfirmDialog
          title={t.assessments.deleteConfirmTitle}
          description={formatMessage(t.assessments.deleteConfirmBody, { prompt: firstLine(deleting.prompt) })}
          confirmLabel={t.assessments.deleteConfirm}
          confirmingLabel={t.assessments.deleting}
          destructive
          loading={deleteM.isPending}
          onConfirm={() => deleteM.mutate({ id: deleting.id }, { onSettled: () => setDeleting(null) })}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

/** The first line of a prompt, shortened, to name the question in the delete confirmation. */
function firstLine(prompt: string): string {
  const line = prompt.split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

function QuizIcon() {
  return (
    <svg
      className="size-8 text-muted"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M9 12h6m-6 4h6M9 4.5h6a1.5 1.5 0 011.5 1.5v.75h-9V6A1.5 1.5 0 019 4.5zM7.5 6.75H6A1.5 1.5 0 004.5 8.25v11.25A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-1.5V8.25A1.5 1.5 0 0018 6.75h-1.5" />
    </svg>
  );
}
