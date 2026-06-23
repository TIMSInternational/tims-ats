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
  none: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  high: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-[#F6F6F6] text-[#585858] border-[#EDEDED]',
};

const SEVERITY_TONE: Record<Severity, string> = {
  none: 'bg-emerald-100 text-emerald-700',
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
};

/** The persisted InterviewSummary row stores its lists as Json columns; coerce to string[]. */
function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

interface InterviewAiPanelProps {
  interviewId: string;
}

export function InterviewAiPanel({ interviewId }: InterviewAiPanelProps) {
  const { t } = useI18n();

  const [guide, setGuide] = useState<InterviewGuideResult | null>(null);
  const [summary, setSummary] = useState<InterviewSummaryResult | null>(null);
  const [bias, setBias] = useState<InterviewBiasResult | null>(null);

  const onError = (message: string) => toast(message, { type: 'error' });

  const guideMutation = trpc.interview.generateGuide.useMutation({
    onSuccess: (data) => setGuide(data),
    onError: (err) => onError(err.message),
  });

  const summaryMutation = trpc.interview.generateSummary.useMutation({
    onSuccess: (data) => setSummary(data),
    onError: (err) => onError(err.message),
  });

  const biasMutation = trpc.interview.detectBias.useMutation({
    onSuccess: (data) => setBias(data),
    onError: (err) => onError(err.message),
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
          onClick={() => summaryMutation.mutate({ interviewId })}
        />
        <AiActionButton
          label={t.interviews.detectBias}
          loadingLabel={t.interviews.generating}
          pending={biasMutation.isPending}
          onClick={() => biasMutation.mutate({ interviewId })}
        />
      </div>

      {!anyResult && (
        <p className="text-[11px] text-[#8B8B8B] text-center px-2 py-4">{t.interviews.aiEmptyState}</p>
      )}

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
  onClick,
}: {
  label: string;
  loadingLabel: string;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="w-full flex items-center justify-center gap-2 bg-[#1F114C] text-white py-2.5 rounded-lg text-[12px] font-medium hover:bg-[#2a1866] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
      {pending ? loadingLabel : label}
    </button>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[#EDEDED] bg-white p-3">
      <h4 className="text-[12px] font-semibold text-[#1F114C] mb-2">{title}</h4>
      {children}
    </div>
  );
}

function BulletList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium text-[#585858] mb-1">{heading}</p>
      <ul className="list-disc list-inside space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[11px] text-[#585858]">
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
              <span className="text-[12px] font-medium text-[#333]">{section.title}</span>
              <span className="text-[10px] text-[#8B8B8B]">
                {section.duration} {t.interviews.minutes}
              </span>
            </div>
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              {section.questions.map((q, qi) => (
                <li key={qi} className="text-[11px] text-[#585858]">
                  {q}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </ResultCard>
  );
}

function SummaryCard({ summary }: { summary: InterviewSummaryResult }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.summaryHeading}>
      <p className="text-[11px] text-[#333] leading-relaxed">{summary.summary}</p>
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
        <span className="text-[11px] text-[#585858]">{t.interviews.overallRiskLabel}:</span>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${RISK_TONE[bias.overallRisk]}`}>
          {t.interviews[RISK_LABEL_KEYS[bias.overallRisk]]}
        </span>
        <span className="text-[10px] text-[#8B8B8B] ml-auto">
          {bias.scorecardsAnalyzed} {t.interviews.scorecardsAnalyzedLabel}
        </span>
      </div>

      <p className="text-[11px] font-medium text-[#585858] mb-1">{t.interviews.biasIndicatorsHeading}</p>
      {bias.biasIndicators.length === 0 ? (
        <p className="text-[11px] text-[#8B8B8B]">{t.interviews.noBiasIndicators}</p>
      ) : (
        <div className="space-y-1.5">
          {bias.biasIndicators.map((indicator, i) => (
            <div key={i} className="rounded border border-[#EDEDED] p-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-[#333]">{indicator.type}</span>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${SEVERITY_TONE[indicator.severity]}`}>
                  {t.interviews[SEVERITY_LABEL_KEYS[indicator.severity]]}
                </span>
              </div>
              <p className="text-[10px] text-[#585858]">{indicator.description}</p>
            </div>
          ))}
        </div>
      )}

      <BulletList heading={t.interviews.recommendationsHeading} items={bias.recommendations} />
    </ResultCard>
  );
}
