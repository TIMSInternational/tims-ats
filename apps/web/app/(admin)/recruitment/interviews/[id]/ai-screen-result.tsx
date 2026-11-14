'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import type { AiInterviewResult } from '../../../../../lib/trpc-types';
import { AiSuggestionNotice } from '../../../../../components/ai-suggestion-notice';

// ---------------------------------------------------------------------------
// AI Voice Interview — recruiter result panel (Task 8).
// Reads aiInterview.getResult and renders status / fitScore / summary /
// strengths / concerns / bias indicators + overall risk / transcript.
//
// summary and biasReport arrive as Prisma.JsonValue (the post-call analysis
// agents persist them as JSON columns), so they are coerced into typed shapes
// here. There is NO re-run-analysis procedure: when analysisStatus === 'failed'
// the panel shows a failure message + contact-support note only.
// ---------------------------------------------------------------------------

type SummaryShape = {
  summary: string;
  keyPoints: string[];
  strengths: string[];
  concerns: string[];
};

type BiasIndicator = {
  type: string;
  severity: string;
  description: string;
};

type BiasShape = {
  biasIndicators: BiasIndicator[];
  overallRisk: string;
  recommendations: string[];
};

type TranscriptTurn = {
  role: string;
  message: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function coerceSummary(value: AiInterviewResult['summary']): SummaryShape | null {
  const rec = asRecord(value);
  if (!rec) return null;
  return {
    summary: typeof rec.summary === 'string' ? rec.summary : '',
    keyPoints: toStringArray(rec.keyPoints),
    strengths: toStringArray(rec.strengths),
    concerns: toStringArray(rec.concerns),
  };
}

function coerceBias(value: AiInterviewResult['biasReport']): BiasShape | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const indicators = Array.isArray(rec.biasIndicators)
    ? rec.biasIndicators
        .map((raw) => asRecord(raw))
        .filter((r): r is Record<string, unknown> => r !== null)
        .map((r) => ({
          type: typeof r.type === 'string' ? r.type : '',
          severity: typeof r.severity === 'string' ? r.severity : '',
          description: typeof r.description === 'string' ? r.description : '',
        }))
    : [];
  return {
    biasIndicators: indicators,
    overallRisk: typeof rec.overallRisk === 'string' ? rec.overallRisk : '',
    recommendations: toStringArray(rec.recommendations),
  };
}

function coerceTranscript(value: AiInterviewResult['transcript']): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((raw) => asRecord(raw))
    .filter((r): r is Record<string, unknown> => r !== null)
    .map((r) => ({
      role: typeof r.role === 'string' ? r.role : '',
      message: typeof r.message === 'string' ? r.message : '',
    }));
}

interface AiScreenResultProps {
  sessionId: string;
}

export function AiScreenResult({ sessionId }: AiScreenResultProps) {
  const { t } = useI18n();
  const query = trpc.aiInterview.getResult.useQuery({ sessionId });

  if (query.isLoading) {
    return <div className="h-24 rounded-lg bg-surface animate-pulse motion-reduce:animate-none" aria-busy="true" />;
  }

  if (query.isError) {
    return <p className="text-callout text-brand-red py-3">{t.interviews.aiResultLoadError}</p>;
  }

  const result = query.data;
  if (!result) {
    return <p className="text-callout text-muted py-3 text-center">{t.interviews.aiResultEmpty}</p>;
  }

  return (
    <div className="space-y-4">
      <ResultHeader status={result.status} fitScore={result.fitScore} />
      <AiSuggestionNotice />
      <AnalysisBody result={result} />
    </div>
  );
}

function ResultHeader({ status, fitScore }: { status: string; fitScore: number | null }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-caption text-secondary">{t.interviews.aiScreenStatusLabel}:</span>
        <span className="text-caption font-medium px-2 py-0.5 rounded-full border border-border bg-surface text-secondary">
          {status}
        </span>
      </div>
      {fitScore !== null && (
        <div className="flex items-center gap-2">
          <span className="text-caption text-secondary">{t.interviews.fitScoreLabel}:</span>
          <span className="text-body font-semibold text-brand">{fitScore}/100</span>
        </div>
      )}
    </div>
  );
}

function AnalysisBody({ result }: { result: AiInterviewResult }) {
  const { t } = useI18n();

  if (result.analysisStatus === 'pending') {
    return <p className="text-callout text-secondary py-3">{t.interviews.analysisInProgress}</p>;
  }

  if (result.analysisStatus === 'failed') {
    // No re-run procedure exists — show the failure + a contact-support note only.
    return (
      <div className="rounded-lg border border-danger/30 bg-danger-bg p-3">
        <p className="text-callout font-medium text-brand-red">{t.interviews.analysisFailed}</p>
        <p className="text-caption text-secondary mt-0.5">{t.interviews.contactSupport}</p>
      </div>
    );
  }

  const summary = coerceSummary(result.summary);
  const bias = coerceBias(result.biasReport);
  const transcript = coerceTranscript(result.transcript);

  return (
    <div className="space-y-3">
      {summary && <SummaryCard summary={summary} />}
      {bias && <BiasCard bias={bias} />}
      <TranscriptCard transcript={transcript} />
    </div>
  );
}

function ResultCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-white p-3">
      <h4 className="text-callout font-semibold text-brand mb-2">{title}</h4>
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
          <li key={i} className="text-caption text-secondary">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCard({ summary }: { summary: SummaryShape }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.aiSummaryHeading}>
      {summary.summary && <p className="text-caption text-primary leading-relaxed">{summary.summary}</p>}
      <BulletList heading={t.interviews.aiStrengthsHeading} items={summary.strengths} />
      <BulletList heading={t.interviews.aiConcernsHeading} items={summary.concerns} />
    </ResultCard>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  none: 'bg-success-bg text-success',
  low: 'bg-success-bg text-success',
  medium: 'bg-warning-bg text-warning',
  high: 'bg-danger-bg text-danger',
};

function BiasCard({ bias }: { bias: BiasShape }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.aiBiasHeading}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-caption text-secondary">{t.interviews.aiOverallRiskLabel}:</span>
        <span className="text-caption font-medium px-2 py-0.5 rounded-full border border-border bg-surface text-secondary">
          {bias.overallRisk}
        </span>
      </div>
      {bias.biasIndicators.length === 0 ? (
        <p className="text-caption text-muted">{t.interviews.aiNoBiasIndicators}</p>
      ) : (
        <div className="space-y-1.5">
          {bias.biasIndicators.map((indicator, i) => (
            <div key={i} className="rounded border border-border p-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-caption font-medium text-primary">{indicator.type}</span>
                <span
                  className={`text-caption font-medium px-1.5 py-0.5 rounded-full ${
                    SEVERITY_TONE[indicator.severity] ?? 'bg-surface text-secondary'
                  }`}
                >
                  {indicator.severity}
                </span>
              </div>
              <p className="text-caption text-secondary">{indicator.description}</p>
            </div>
          ))}
        </div>
      )}
    </ResultCard>
  );
}

function TranscriptCard({ transcript }: { transcript: TranscriptTurn[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <ResultCard title={t.interviews.transcriptHeading}>
      {transcript.length === 0 ? (
        <p className="text-caption text-muted">{t.interviews.noTranscript}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-caption font-medium text-brand hover:underline"
          >
            {open ? t.interviews.hideTranscript : t.interviews.showTranscript}
          </button>
          {open && (
            <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
              {transcript.map((turn, i) => (
                <div key={i} className="text-caption">
                  <span className="font-medium text-primary">{turn.role}: </span>
                  <span className="text-secondary">{turn.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ResultCard>
  );
}
