'use client';

import { useI18n } from '../../../../../../lib/i18n';
import { formatTranscriptTime, type TranscriptAnalysisView } from '../../../../../../lib/interview-transcription';
import type { ScorecardSuggestion } from './scorecard-suggestion';

interface TranscriptAiResultProps {
  analysis: TranscriptAnalysisView;
  /** Copies one competency's suggestion into the evaluator's draft (never submits). */
  onApply?: (suggestion: Omit<ScorecardSuggestion, 'id'>) => void;
}

/** The advisory analysis: every suggestion carries its evidence (verbatim quote + timestamp). */
export function TranscriptAiResult({ analysis, onApply }: TranscriptAiResultProps) {
  const { t } = useI18n();
  const copy = t.interviewTranscription;
  const heading = 'text-[11px] font-semibold text-[#1F114C] mt-3 mb-1';
  return (
    <div className="text-[11px] text-[#333]" data-testid="transcript-ai-result">
      {analysis.summary && (
        <>
          <p className={heading}>{copy.summaryHeading}</p>
          <p className="leading-relaxed">{analysis.summary}</p>
        </>
      )}

      {analysis.competencies.length > 0 && <p className={heading}>{copy.competenciesHeading}</p>}
      <ul className="space-y-2">
        {analysis.competencies.map((c) => (
          <li key={c.key} className="rounded border border-[#EDEDED] p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{c.label}</span>
              <span className="text-[10px] text-[#585858]">
                {c.suggestedRating === null
                  ? copy.noRating
                  : copy.suggestedRating.replace('{n}', String(c.suggestedRating))}
              </span>
            </div>
            {c.rationale && <p className="mt-1 text-[#585858]">{c.rationale}</p>}
            <ul className="mt-1 space-y-0.5">
              {c.evidence.map((e) => (
                <li key={`${e.atSeconds}-${e.quote}`} className="text-[10px] text-[#585858]">
                  <span className="font-mono">[{formatTranscriptTime(e.atSeconds)}]</span> «{e.quote}»
                </li>
              ))}
            </ul>
            {onApply && (
              <button
                type="button"
                onClick={() =>
                  onApply({
                    key: c.key,
                    rating: c.suggestedRating,
                    noteLines: c.evidence.map((e) =>
                      copy.notesEvidenceLine
                        .replace('{label}', () => c.label)
                        .replace('{quote}', () => e.quote)
                        .replace('{time}', () => formatTranscriptTime(e.atSeconds)),
                    ),
                  })
                }
                className="mt-2 text-[10px] font-medium text-[#1F114C] underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] rounded"
              >
                {copy.applyToScorecard}
              </button>
            )}
          </li>
        ))}
      </ul>

      {analysis.questions.length > 0 && <p className={heading}>{copy.questionsHeading}</p>}
      <ol className="space-y-1.5">
        {analysis.questions.map((q, i) => (
          <li key={`${q.askedAtSeconds}-${i}`}>
            <p className="font-medium">
              <span className="font-mono text-[10px] text-[#8B8B8B]">[{formatTranscriptTime(q.askedAtSeconds)}]</span>{' '}
              {q.question}
            </p>
            {q.answerSummary && <p className="text-[#585858]">{q.answerSummary}</p>}
            {q.answerQuote && <p className="text-[10px] italic text-[#585858]">«{q.answerQuote}»</p>}
          </li>
        ))}
      </ol>

      {analysis.limitations.length > 0 && (
        <>
          <p className={heading}>{copy.limitationsHeading}</p>
          <ul className="list-disc list-inside text-[10px] text-[#8B8B8B]">
            {analysis.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
