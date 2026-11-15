'use client';

import { useRef, useState } from 'react';
import { validateQuestionCoherence, QUESTION_TYPES } from '@tims/shared';
import type { QuestionType, QuestionOption } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  Button,
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  Field,
  FIELD_LABEL_CLASSES,
  IconButton,
  Modal,
  Select,
  TextArea,
  TextInput,
} from '../../../../components';

export interface EditableQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: QuestionOption[];
  correctOptionIds: string[];
  points: number;
  order: number;
  isActive: boolean;
}

interface QuestionModalProps {
  assessmentTypeId: string;
  question?: EditableQuestion | null;
  onClose: () => void;
  onSaved: () => void;
}

function newOption(): QuestionOption {
  return { id: crypto.randomUUID(), label: '' };
}

export function QuestionModal({ assessmentTypeId, question, onClose, onSaved }: QuestionModalProps) {
  const { t } = useI18n();
  const isEdit = !!question;

  const [type, setType] = useState<QuestionType>(question?.type ?? 'single_choice');
  const [prompt, setPrompt] = useState(question?.prompt ?? '');
  const [options, setOptions] = useState<QuestionOption[]>(
    question?.options?.length ? question.options : [newOption(), newOption()],
  );
  const [correctOptionIds, setCorrectOptionIds] = useState<string[]>(question?.correctOptionIds ?? []);
  const [points, setPoints] = useState(question?.points ?? 1);
  const [order, setOrder] = useState(question?.order ?? 0);
  const [isActive, setIsActive] = useState(question?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const isFreeText = type === 'free_text';
  const errorMap = t.assessments.errors as Record<string, string>;

  // The dialog stays open on failure: the error shows inline (role="alert") and, per the project rule
  // (.claude/rules/frontend.md: onError toast on every mutation), as a toast too.
  const onError = (err: { message: string }) => {
    const message = errorMap[err.message] ?? err.message;
    setError(message);
    toast(message, { type: 'error' });
  };

  const createM = trpc.assessment.createQuestion.useMutation({
    onSuccess: () => {
      toast(t.assessments.created, { type: 'success' });
      onSaved();
    },
    onError,
  });
  const updateM = trpc.assessment.updateQuestion.useMutation({
    onSuccess: () => {
      toast(t.assessments.updated, { type: 'success' });
      onSaved();
    },
    onError,
  });
  const isPending = createM.isPending || updateM.isPending;

  const setOptionLabel = (id: string, label: string) =>
    setOptions((prev) => prev.map((o) => (o.id === id ? { ...o, label } : o)));

  const removeOption = (id: string) => {
    setOptions((prev) => prev.filter((o) => o.id !== id));
    setCorrectOptionIds((prev) => prev.filter((c) => c !== id));
  };

  const toggleCorrect = (id: string) => {
    if (type === 'single_choice') {
      setCorrectOptionIds([id]);
    } else {
      setCorrectOptionIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
    }
  };

  const handleSubmit = () => {
    setError(null);
    const cleanOptions = isFreeText
      ? []
      : options.map((o) => ({ id: o.id, label: o.label.trim() })).filter((o) => o.label);
    const cleanCorrect = isFreeText ? [] : correctOptionIds.filter((id) => cleanOptions.some((o) => o.id === id));

    if (!prompt.trim()) {
      setError(t.assessments.promptRequired);
      promptRef.current?.focus();
      return;
    }
    const coherence = validateQuestionCoherence({ type, options: cleanOptions, correctOptionIds: cleanCorrect });
    if (!coherence.valid) {
      setError(errorMap[coherence.code] ?? coherence.code);
      return;
    }

    if (isEdit && question) {
      updateM.mutate({
        id: question.id,
        type,
        prompt: prompt.trim(),
        options: cleanOptions,
        correctOptionIds: cleanCorrect,
        points,
        order,
        isActive,
      });
    } else {
      createM.mutate({
        assessmentTypeId,
        type,
        prompt: prompt.trim(),
        options: cleanOptions,
        correctOptionIds: cleanCorrect,
        points,
        order,
      });
    }
  };

  const f = t.assessments.fields;
  return (
    <Modal
      title={isEdit ? t.assessments.editTitle : t.assessments.createTitle}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.assessments.cancel}
          </Button>
          <Button onClick={handleSubmit} loading={isPending} loadingLabel={t.assessments.saving}>
            {isEdit ? t.assessments.save : t.assessments.create}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={f.type} id="question-type">
          <Select
            value={type}
            onChange={(e) => {
              const next = e.target.value as QuestionType;
              setType(next);
              if (next === 'single_choice') setCorrectOptionIds((prev) => prev.slice(0, 1));
            }}
          >
            {QUESTION_TYPES.map((qt) => (
              <option key={qt} value={qt}>
                {t.assessments.types[qt]}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={f.prompt}
          id="question-prompt"
          required
          error={error === t.assessments.promptRequired ? error : undefined}
        >
          <TextArea
            ref={promptRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={f.promptPlaceholder}
            rows={3}
            maxLength={5000}
          />
        </Field>

        {!isFreeText && (
          <fieldset>
            <legend className={FIELD_LABEL_CLASSES}>{f.markCorrect}</legend>
            <div className="space-y-2">
              {options.map((opt, index) => {
                const n = index + 1;
                return (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      type={type === 'single_choice' ? 'radio' : 'checkbox'}
                      name="question-correct"
                      checked={correctOptionIds.includes(opt.id)}
                      onChange={() => toggleCorrect(opt.id)}
                      aria-label={formatMessage(f.markCorrectN, { n })}
                      className={CHOICE_INPUT_CLASSES}
                    />
                    <TextInput
                      value={opt.label}
                      onChange={(e) => setOptionLabel(opt.id, e.target.value)}
                      placeholder={f.optionPlaceholder}
                      aria-label={formatMessage(f.optionN, { n })}
                      maxLength={500}
                      className="flex-1"
                    />
                    {options.length > 2 && (
                      <IconButton label={formatMessage(f.removeOptionN, { n })} onClick={() => removeOption(opt.id)}>
                        <svg
                          className="size-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <path d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
            {options.length < 20 && (
              <Button
                variant="tertiary"
                size="sm"
                className="mt-2"
                onClick={() => setOptions((prev) => [...prev, newOption()])}
              >
                + {f.addOption}
              </Button>
            )}
          </fieldset>
        )}

        <div className="flex flex-wrap items-end gap-4">
          <Field label={f.points} id="question-points" className="w-28">
            <TextInput
              type="number"
              min={1}
              max={1000}
              value={points}
              onChange={(e) => setPoints(Math.max(1, Number(e.target.value) || 1))}
              className="tabular-nums"
            />
          </Field>
          <Field label={f.order} id="question-order" className="w-28">
            <TextInput
              type="number"
              min={0}
              max={10000}
              value={order}
              onChange={(e) => setOrder(Math.max(0, Number(e.target.value) || 0))}
              className="tabular-nums"
            />
          </Field>
          {isEdit && (
            <label className={CHOICE_ROW_CLASSES}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className={CHOICE_INPUT_CLASSES}
              />
              {f.active}
            </label>
          )}
        </div>

        {error && error !== t.assessments.promptRequired && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
