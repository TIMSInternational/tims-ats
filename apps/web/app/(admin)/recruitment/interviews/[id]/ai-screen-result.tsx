'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import type { AiInterviewResult } from '../../../../../lib/trpc-types';

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
    return <div className="h-24 rounded-lg bg-[#F6F6F6] animate-pulse" aria-busy="true" />;
  }

  if (query.isError) {
    return <p className="text-[12px] text-[#DD0C15] py-3">{t.interviews.aiResultLoadError}</p>;
  }

  const result = query.data;
  if (!result) {
    return <p className="text-[12px] text-[#8B8B8B] py-3 text-center">{t.interviews.aiResultEmpty}</p>;
  }

  return (
    <div className="space-y-4">
      <ResultHeader status={result.status} fitScore={result.fitScore} />
      <AnalysisBody result={result} />
    </div>
  );
}

function ResultHeader({ status, fitScore }: { status: string; fitScore: number | null }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#585858]">{t.interviews.aiScreenStatusLabel}:</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[#EDEDED] bg-[#F6F6F6] text-[#585858]">
          {status}
        </span>
      </div>
      {fitScore !== null && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#585858]">{t.interviews.fitScoreLabel}:</span>
          <span className="text-[13px] font-semibold text-[#1F114C]">{fitScore}/100</span>
        </div>
      )}
    </div>
  );
}

function AnalysisBody({ result }: { result: AiInterviewResult }) {
  const { t } = useI18n();

  if (result.analysisStatus === 'pending') {
    return <p className="text-[12px] text-[#585858] py-3">{t.interviews.analysisInProgress}</p>;
  }

  if (result.analysisStatus === 'failed') {
    // No re-run procedure exists — show the failure + a contact-support note only.
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
        <p className="text-[12px] font-medium text-[#DD0C15]">{t.interviews.analysisFailed}</p>
        <p className="text-[11px] text-[#585858] mt-0.5">{t.interviews.contactSupport}</p>
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

function SummaryCard({ summary }: { summary: SummaryShape }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.aiSummaryHeading}>
      {summary.summary && <p className="text-[11px] text-[#333] leading-relaxed">{summary.summary}</p>}
      <BulletList heading={t.interviews.aiStrengthsHeading} items={summary.strengths} />
      <BulletList heading={t.interviews.aiConcernsHeading} items={summary.concerns} />
    </ResultCard>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  none: 'bg-emerald-100 text-emerald-700',
  low: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-red-100 text-red-700',
};

function BiasCard({ bias }: { bias: BiasShape }) {
  const { t } = useI18n();
  return (
    <ResultCard title={t.interviews.aiBiasHeading}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[11px] text-[#585858]">{t.interviews.aiOverallRiskLabel}:</span>
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border border-[#EDEDED] bg-[#F6F6F6] text-[#585858]">
          {bias.overallRisk}
        </span>
      </div>
      {bias.biasIndicators.length === 0 ? (
        <p className="text-[11px] text-[#8B8B8B]">{t.interviews.aiNoBiasIndicators}</p>
      ) : (
        <div className="space-y-1.5">
          {bias.biasIndicators.map((indicator, i) => (
            <div key={i} className="rounded border border-[#EDEDED] p-2">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-medium text-[#333]">{indicator.type}</span>
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${
                    SEVERITY_TONE[indicator.severity] ?? 'bg-[#F6F6F6] text-[#585858]'
                  }`}
                >
                  {indicator.severity}
                </span>
              </div>
              <p className="text-[10px] text-[#585858]">{indicator.description}</p>
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
        <p className="text-[11px] text-[#8B8B8B]">{t.interviews.noTranscript}</p>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-[11px] font-medium text-[#1F114C] hover:underline"
          >
            {open ? t.interviews.hideTranscript : t.interviews.showTranscript}
          </button>
          {open && (
            <div className="mt-2 space-y-1.5 max-h-72 overflow-y-auto">
              {transcript.map((turn, i) => (
                <div key={i} className="text-[11px]">
                  <span className="font-medium text-[#333]">{turn.role}: </span>
                  <span className="text-[#585858]">{turn.message}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </ResultCard>
  );
}
