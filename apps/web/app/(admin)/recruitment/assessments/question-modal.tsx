'use client';

import { useState } from 'react';
import { validateQuestionCoherence, QUESTION_TYPES } from '@tims/shared';
import type { QuestionType, QuestionOption } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

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

const inputClass =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]';
const labelClass = 'block text-xs font-medium text-[#8B8B8B] mb-1.5';

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

  const isFreeText = type === 'free_text';
  const errorMap = t.assessments.errors as Record<string, string>;

  const onError = (err: { message: string }) => {
    setError(errorMap[err.message] ?? err.message);
    toast(errorMap[err.message] ?? err.message, { type: 'error' });
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

  return (
    <Modal title={isEdit ? t.assessments.editTitle : t.assessments.createTitle} onClose={onClose} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div>
          <label className={labelClass}>{t.assessments.fields.type}</label>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as QuestionType;
              setType(next);
              if (next === 'single_choice') setCorrectOptionIds((prev) => prev.slice(0, 1));
            }}
            className={inputClass}
          >
            {QUESTION_TYPES.map((qt) => (
              <option key={qt} value={qt}>
                {t.assessments.types[qt]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>{t.assessments.fields.prompt}</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.assessments.fields.promptPlaceholder}
            rows={3}
            maxLength={5000}
            className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
          />
        </div>

        {!isFreeText && (
          <div>
            <label className={labelClass}>{t.assessments.fields.markCorrect}</label>
            <div className="space-y-2">
              {options.map((opt) => (
                <div key={opt.id} className="flex items-center gap-2">
                  <input
                    type={type === 'single_choice' ? 'radio' : 'checkbox'}
                    checked={correctOptionIds.includes(opt.id)}
                    onChange={() => toggleCorrect(opt.id)}
                    aria-label={t.assessments.fields.markCorrect}
                    className="shrink-0"
                  />
                  <input
                    value={opt.label}
                    onChange={(e) => setOptionLabel(opt.id, e.target.value)}
                    placeholder={t.assessments.fields.optionPlaceholder}
                    maxLength={500}
                    className="flex-1 h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:border-[#1F114C]"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => removeOption(opt.id)}
                      className="shrink-0 w-8 h-8 rounded-lg text-[#8B8B8B] hover:bg-[#F5F5F5]"
                      aria-label={t.assessments.delete}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {options.length < 20 && (
              <button
                type="button"
                onClick={() => setOptions((prev) => [...prev, newOption()])}
                className="mt-2 text-xs font-medium text-[#1F114C] hover:underline"
              >
                + {t.assessments.fields.addOption}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-4">
          <div className="w-28">
            <label className={labelClass}>{t.assessments.fields.points}</label>
            <input
              type="number"
              min={1}
              max={1000}
              value={points}
              onChange={(e) => setPoints(Math.max(1, Number(e.target.value) || 1))}
              className={inputClass}
            />
          </div>
          <div className="w-28">
            <label className={labelClass}>{t.assessments.fields.order}</label>
            <input
              type="number"
              min={0}
              max={10000}
              value={order}
              onChange={(e) => setOrder(Math.max(0, Number(e.target.value) || 0))}
              className={inputClass}
            />
          </div>
          {isEdit && (
            <label className="flex items-end gap-2 pb-2.5 text-sm text-[#585858]">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t.assessments.fields.active}
            </label>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F5F5F5]"
          >
            {t.assessments.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="h-10 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] disabled:opacity-50"
          >
            {isEdit ? t.assessments.save : t.assessments.create}
          </button>
        </div>
      </div>
    </Modal>
  );
}
