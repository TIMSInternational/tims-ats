'use client';

import { useState } from 'react';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import type {
  InterviewGuideResult,
  InterviewSummaryResult,
  InterviewBiasResult,
  InterviewBiasIndicator,
} from '../../../../../../lib/trpc-types';
import { GuideCompetencyQuestions } from './guide-competency-questions';
import { Button } from '../../../../../../components/button';
import { AiSuggestionNotice } from '../../../../../../components/ai-suggestion-notice';

// ---------------------------------------------------------------------------
// Interview AI panel — surfaces the three LIVE interview-AI endpoints
// (generateGuide / generateSummary / detectBias). All are MUTATIONS: each call
// spends AI budget, so they fire only on a button press and never auto-run on
// mount. Replaces the old placeholder "AI Coach" tab + the hardcoded
// "Deteccion de Sesgo" mock alert that lived in scorecard-panel.tsx.
// ---------------------------------------------------------------------------

type RiskLevel = InterviewBiasResult['overallRisk'];
type Severity = InterviewBiasIndicator['severity'];

const RISK_LABEL_KEYS: Record<RiskLevel, 'riskNone' | 'riskLow' | 'riskMedium' | 'riskHigh' | 'riskUnknown'> = {
  none: 'riskNone',
  low: 'riskLow',
  medium: 'riskMedium',
  high: 'riskHigh',
  unknown: 'riskUnknown',
};

const SEVERITY_LABEL_KEYS: Record<Severity, 'severityNone' | 'severityLow' | 'severityMedium' | 'severityHigh'> = {
  none: 'severityNone',
  low: 'severityLow',
  medium: 'severityMedium',
  high: 'severityHigh',
};

const RISK_TONE: Record<RiskLevel, string> = {
  none: 'bg-success-bg text-success border-success/30',
  low: 'bg-success-bg text-success border-success/30',
  medium: 'bg-warning-bg text-warning border-warning/30',
  high: 'bg-danger-bg text-danger border-danger/30',
  unknown: 'bg-surface text-secondary border-border',
};

const SEVERITY_TONE: Record<Severity, string> = {
  none: 'bg-success-bg text-success',
  low: 'bg-success-bg text-success',
  medium: 'bg-warning-bg text-warning',
  high: 'bg-danger-bg text-danger',
};

/** The persisted InterviewSummary row stores its lists as Json columns; coerce to string[]. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface InterviewAiPanelProps {
  interviewId: string;
  /**
   * The viewer is a panel evaluator who has not submitted their scorecard. The server
   * refuses the summary and bias check (FORBIDDEN) until they do — blind evaluation,
   * packages/api/src/services/scorecard-visibility.service.ts — so those buttons are
   * disabled with an explanation instead of spending a click on a refusal.
   */
  isViewerBlinded?: boolean;
}

/** The error shape a tRPC mutation hands to onError (only the fields read here). */
interface AiMutationError {
  message: string;
  data?: { code?: string } | null;
}

export function InterviewAiPanel({ interviewId, isViewerBlinded = false }: InterviewAiPanelProps) {
  const { t } = useI18n();

  const [guide, setGuide] = useState<InterviewGuideResult | null>(null);
  const [summary, setSummary] = useState<InterviewSummaryResult | null>(null);
  const [bias, setBias] = useState<InterviewBiasResult | null>(null);

  const onError = (message: string) => toast(message, { type: 'error' });
  // The summary / bias FORBIDDEN carries a hardcoded-Spanish server message; show a
  // localized one instead: the blind-evaluation reason when it applies, else a permission one.
  const onScorecardAiError = (err: AiMutationError) =>
    onError(
      err.data?.code === 'FORBIDDEN'
        ? isViewerBlinded
          ? t.interviews.aiBlinded
          : t.interviews.aiForbidden
        : err.message,
    );

  const guideMutation = trpc.interview.generateGuide.useMutation({
    onSuccess: (data) => setGuide(data),
    onError: (err) => onError(err.message),
  });

  const summaryMutation = trpc.interview.generateSummary.useMutation({
    onSuccess: (data) => setSummary(data),
    onError: onScorecardAiError,
  });

  const biasMutation = trpc.interview.detectBias.useMutation({
    onSuccess: (data) => setBias(data),
    onError: onScorecardAiError,
  });

  const anyResult = guide || summary || bias;

  return (
    <div className="space-y-4">
      {/* Action buttons */}
      <div className="space-y-2">
        <AiActionButton
          label={t.interviews.generateGuide}
          loadingLabel={t.interviews.generating}
          pending={guideMutation.isPending}
          onClick={() => guideMutation.mutate({ interviewId })}
        />
        <AiActionButton
          label={t.interviews.generateSummary}
          loadingLabel={t.interviews.generating}
          pending={summaryMutation.isPending}
          blocked={isViewerBlinded}
          onClick={() => summaryMutation.mutate({ interviewId })}
        />
        <AiActionButton
          label={t.interviews.detectBias}
          loadingLabel={t.interviews.generating}
          pending={biasMutation.isPending}
          blocked={isViewerBlinded}
          onClick={() => biasMutation.mutate({ interviewId })}
        />
        {isViewerBlinded && <p className="text-callout text-secondary px-1">{t.interviews.aiBlinded}</p>}
      </div>

      {!anyResult && (
        <p className="text-callout text-secondary text-center px-2 py-4">{t.interviews.aiEmptyState}</p>
      )}

      {/* AI output is marked as a suggestion the evaluator decides on (generative-ai.md › Best practices). */}
      {anyResult && <AiSuggestionNotice className="mb-2" />}

      {guide && <GuideCard guide={guide} />}
      {summary && <SummaryCard summary={summary} />}
      {bias && <BiasCard bias={bias} />}
    </div>
  );
}

function AiActionButton({
  label,
  loadingLabel,
  pending,
  blocked = false,
  onClick,
}: {
  label: string;
  loadingLabel: string;
  pending: boolean;
  blocked?: boolean;
  onClick: () => void;
}) {
  return (
    <Button variant="secondary" fullWidth onClick={onClick} disabled={blocked} loading={pending} loadingLabel={loadingLabel}>
      {label}
    </Button>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <h4 className="text-subheading font-semibold text-brand mb-2">{title}</h4>
      {children}
    </div>
  );
}

function BulletList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-caption font-medium text-secondary mb-1">{heading}</p>
      <ul className="list-disc list-inside space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-callout text-secondary">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuideCard({ guide }: { guide: InterviewGuideResult }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.guideHeading}>
      <div className="space-y-3">
        {guide.sections.map((section, i) => (
          <div key={i}>
            <div className="flex items-baseline justify-between">
              <span className="text-callout font-medium text-primary">{section.title}</span>
              <span className="text-caption text-muted">
                {section.duration} {t.interviews.minutes}
              </span>
            </div>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {section.questions.map((q, qi) => (
                <li key={qi} className="text-callout text-secondary">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <GuideCompetencyQuestions sets={guide.competencyQuestions} />
      </div>
    </ResultCard>
  );
}

function SummaryCard({ summary }: { summary: InterviewSummaryResult }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.summaryHeading}>
      <p className="text-callout text-primary leading-relaxed max-w-prose">{summary.summary}</p>
      <BulletList heading={t.interviews.keyPointsHeading} items={toStringArray(summary.keyPoints)} />
      <BulletList heading={t.interviews.strengthsHeading} items={toStringArray(summary.strengths)} />
      <BulletList heading={t.interviews.concernsHeading} items={toStringArray(summary.concerns)} />
    </ResultCard>
  );
}

function BiasCard({ bias }: { bias: InterviewBiasResult }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.biasHeading}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-caption text-secondary">{t.interviews.overallRiskLabel}:</span>
        <span className={`text-caption font-medium px-2 py-0.5 rounded-full border ${RISK_TONE[bias.overallRisk]}`}>
          {t.interviews[RISK_LABEL_KEYS[bias.overallRisk]]}
        </span>
        <span className="text-caption text-muted ml-auto">
          {bias.scorecardsAnalyzed} {t.interviews.scorecardsAnalyzedLabel}
        </span>
      </div>

      <p className="text-caption font-medium text-secondary mb-1">{t.interviews.biasIndicatorsHeading}</p>
      {bias.biasIndicators.length === 0 ? (
        <p className="text-caption text-muted">{t.interviews.noBiasIndicators}</p>
      ) : (
        <div className="space-y-1.5">
          {bias.biasIndicators.map((indicator, i) => (
            <div key={i} className="rounded border border-border p-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-caption font-medium text-primary">{indicator.type}</span>
                <span className={`text-caption font-medium px-1.5 py-0.5 rounded-full ${SEVERITY_TONE[indicator.severity]}`}>
                  {t.interviews[SEVERITY_LABEL_KEYS[indicator.severity]]}
                </span>
              </div>
              <p className="text-callout text-secondary">{indicator.description}</p>
            </div>
          ))}
        </div>
      )}

      <BulletList heading={t.interviews.recommendationsHeading} items={bias.recommendations} />
    </ResultCard>
  );
}
