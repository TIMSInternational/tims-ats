'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Button, SegmentedControl } from '../../../../components';
import type { VacancyDescriptionVariants, InclusiveLanguageResult } from '../../../../lib/trpc-types';

// ---------------------------------------------------------------------------
// Sprint 1.3 Task 4 — vacancy-creation wizard AI panel.
// Two independent pieces, both extracted out of create-modal.fields.tsx to
// keep that file under the 300-line component limit (CLAUDE.md):
//   1. AiGeneratePanel — one Bedrock call (vacancy.generateDescription) that
//      returns 3 variants (formal/social/whatsapp); each is individually
//      "usable" via a per-tab "Use this" action.
//   2. InclusiveCheckPanel — wires the already-built-but-frontend-unused
//      checkInclusiveLanguage agent onto the current description text.
// ---------------------------------------------------------------------------

type VariantTab = 'formal' | 'social' | 'whatsapp';

interface AiGeneratePanelProps {
  title: string;
  location: string;
  onUseFormal: (
    description: string,
    sections: { responsibilities: string[]; requirements: string[]; benefits: string[] },
  ) => void;
  /** The formal variant would overwrite text the recruiter already typed: say "Reemplazar…", not "Usar…". */
  formalWillReplace?: boolean;
  /** Restores the fields the formal variant replaced; offered right after applying it. */
  onUndoFormal?: () => void;
  onUseSocial: (description: string) => void;
  onUseWhatsapp: (description: string) => void;
  /** The competencies the vacancy writer suggested with this description (for review in step 2). */
  onSuggestedCompetencies?: (list: VacancyDescriptionVariants['competencies']) => void;
}

export function AiGeneratePanel({
  title,
  location,
  onUseFormal,
  formalWillReplace = false,
  onUndoFormal,
  onUseSocial,
  onUseWhatsapp,
  onSuggestedCompetencies,
}: AiGeneratePanelProps) {
  const { t } = useI18n();
  const [variants, setVariants] = useState<VacancyDescriptionVariants | null>(null);
  const [tab, setTab] = useState<VariantTab>('formal');
  // Inline acknowledgement of the last "Usar" (generative-ai.md › Outputs: acknowledge, and let people revert).
  const [applied, setApplied] = useState<VariantTab | null>(null);

  const generate = trpc.vacancy.generateDescription.useMutation({
    onSuccess: (data) => {
      if (data.kind !== 'variants') return;
      setVariants(data);
      setTab('formal');
      setApplied(null);
      toast(t.vacancies.aiVariantsGenerated, { type: 'success' });
      // Shown for review in "Competencias del puesto", right below this panel.
      if (data.competencies.length > 0) onSuggestedCompetencies?.(data.competencies);
    },
  });

  const canGenerate = title.trim().length > 0;
  const activeDescription =
    variants &&
    (tab === 'formal'
      ? variants.formal.description
      : tab === 'social'
        ? variants.social.description
        : variants.whatsapp.description);
  const useLabel = tab === 'formal' && formalWillReplace ? t.vacancies.aiReplaceVariant : t.vacancies.aiUseVariant;

  return (
    <section
      aria-labelledby="vacancy-ai-title"
      className="space-y-3 rounded-lg border border-border bg-surface-hover p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 id="vacancy-ai-title" className="text-body font-semibold text-brand">
            {t.vacancies.aiGenerateTitle}
          </h3>
          <p className="text-callout text-secondary">{t.vacancies.aiGenerateDesc}</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => generate.mutate({ title, context: location.trim() || undefined })}
          disabled={!canGenerate}
          loading={generate.isPending}
          loadingLabel={t.vacancies.aiGenerating}
        >
          {t.vacancies.aiGenerateAction}
        </Button>
      </div>

      {!canGenerate && <p className="text-callout text-secondary">{t.vacancies.aiGenerateNeedsTitle}</p>}
      {generate.isError && (
        <p role="alert" className="text-callout text-danger">
          {generate.error.message}
        </p>
      )}

      {variants && (
        <div className="space-y-2">
          <SegmentedControl<VariantTab>
            label={t.vacancies.aiVariantGroup}
            options={[
              { value: 'formal', label: t.vacancies.aiVariantFormal },
              { value: 'social', label: t.vacancies.aiVariantSocial },
              { value: 'whatsapp', label: t.vacancies.aiVariantWhatsapp },
            ]}
            value={tab}
            onChange={setTab}
            fullWidth
          />

          <div
            id="vacancy-ai-preview"
            aria-live="polite"
            className="max-h-60 overflow-y-auto rounded-lg border border-border bg-white p-3"
          >
            <p className="whitespace-pre-wrap text-body text-primary">{activeDescription}</p>
          </div>
          <p className="text-callout text-secondary">{t.vacancies.aiReviewWarning}</p>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (tab === 'formal') onUseFormal(variants.formal.description, variants.formal.sections);
                else if (tab === 'social') onUseSocial(variants.social.description);
                else onUseWhatsapp(variants.whatsapp.description);
                setApplied(tab);
              }}
            >
              {useLabel}
            </Button>
            {applied !== null && (
              <p role="status" className="flex flex-wrap items-center gap-1 text-callout text-success">
                {t.vacancies.aiVariantApplied}
                {applied === 'formal' && onUndoFormal && (
                  <Button
                    variant="tertiary"
                    size="sm"
                    onClick={() => {
                      onUndoFormal();
                      setApplied(null);
                    }}
                  >
                    {t.vacancies.aiUndo}
                  </Button>
                )}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

interface InclusiveCheckPanelProps {
  text: string;
}

export function InclusiveCheckPanel({ text }: InclusiveCheckPanelProps) {
  const { t } = useI18n();
  const [result, setResult] = useState<InclusiveLanguageResult | null>(null);
  const [checkedText, setCheckedText] = useState<string | null>(null);

  const check = trpc.vacancy.checkInclusiveLanguage.useMutation({
    onSuccess: (data, variables) => {
      setResult(data);
      setCheckedText(variables.text);
    },
  });

  const canCheck = text.trim().length > 0;
  const scoreColor =
    result && result.score !== null
      ? result.score >= 80
        ? 'text-success'
        : result.score >= 50
          ? 'text-warning'
          : 'text-danger'
      : '';
  const stale = result !== null && checkedText !== null && checkedText !== text;

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => check.mutate({ text })}
        disabled={!canCheck}
        loading={check.isPending}
        loadingLabel={t.vacancies.inclusiveChecking}
      >
        {t.vacancies.inclusiveCheckAction}
      </Button>

      {check.isError && (
        <p role="alert" className="text-callout text-danger">
          {check.error.message}
        </p>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-border bg-surface-hover p-3">
          <p className="text-callout font-medium text-primary">
            {t.vacancies.inclusiveScoreLabel}:{' '}
            <span className={scoreColor}>
              {result.score === null ? t.vacancies.inclusiveScoreUnavailable : `${result.score}/100`}
            </span>
          </p>
          {stale && <p className="text-caption text-secondary">{t.vacancies.inclusiveStale}</p>}
          {result.score === null ? (
            <p className="text-callout text-secondary">{t.vacancies.inclusiveUnavailable}</p>
          ) : result.suggestions.length > 0 ? (
            <ul className="space-y-2">
              {result.suggestions.map((s, i) => (
                <li key={i} className="text-callout text-primary">
                  <span className="sr-only">{t.vacancies.inclusiveChange} </span>
                  <del className="text-secondary">{s.original}</del>
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only"> {t.vacancies.inclusiveBy} </span>
                  <ins className="no-underline font-medium">{s.suggestion}</ins>
                  <p className="text-callout text-secondary">{s.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-callout text-secondary">{t.vacancies.inclusiveNoSuggestions}</p>
          )}
        </div>
      )}
    </div>
  );
}
