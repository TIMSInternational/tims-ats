'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';

interface Vacancy { id: string; title: string }

const REC_META: Record<string, { key: 'recAdvance' | 'recReview' | 'recReject'; cls: string }> = {
  advance: { key: 'recAdvance', cls: 'bg-green-50 text-green-700' },
  review: { key: 'recReview', cls: 'bg-amber-50 text-amber-700' },
  reject: { key: 'recReject', cls: 'bg-red-50 text-red-700' },
};

export function ScreenCandidateCard({ candidateId, vacancies }: { candidateId: string; vacancies: Vacancy[] }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [vacancyId, setVacancyId] = useState(vacancies[0]?.id ?? '');

  const screen = trpc.candidate.screen.useMutation({
    onSuccess: () => {
      toast(t.candidateAi.screenSaved, { type: 'success' });
      // Refresh the candidate so the new FitScore shows in FitBreakdown.
      void utils.candidate.getById.invalidate({ id: candidateId });
    },
    onError: () => toast(t.candidateAi.screenError, { type: 'error' }),
  });
  const r = screen.data;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.candidateAi.screenTitle}</h3>

      {vacancies.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.candidateAi.screenNoVacancies}</p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <select
              value={vacancyId}
              onChange={(e) => setVacancyId(e.target.value)}
              className="flex-1 border border-[#EDEDED] rounded-lg px-2.5 h-8 text-[12px] outline-none focus:border-[#1F114C]"
            >
              {vacancies.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
            <button
              onClick={() => screen.mutate({ candidateId, vacancyId })}
              disabled={!vacancyId || screen.isPending}
              className="bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium disabled:opacity-50 shrink-0"
            >
              {screen.isPending ? t.candidateAi.screening : t.candidateAi.screenButton}
            </button>
          </div>

          {r && (
            <div className="mt-3 pt-3 border-t border-[#EDEDED] space-y-2 text-[12px]">
              <div className="flex items-center justify-between">
                <span className="text-[#8B8B8B]">{t.candidateAi.score}</span>
                <span className="text-[18px] font-bold text-[#1F114C]">{r.score}<span className="text-[11px] text-[#8B8B8B] font-normal">/100</span></span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[#8B8B8B]">{t.candidateAi.recommendation}</span>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${REC_META[r.recommendation]?.cls ?? ''}`}>
                  {t.candidateAi[REC_META[r.recommendation]?.key ?? 'recReview']}
                </span>
              </div>
              {r.matchedSkills.length > 0 && <SkillRow label={t.candidateAi.matchedSkills} items={r.matchedSkills} cls="text-green-700" />}
              {r.missingSkills.length > 0 && <SkillRow label={t.candidateAi.missingSkills} items={r.missingSkills} cls="text-[#DD0C15]" />}
              {r.reasoning && (
                <div>
                  <p className="text-[10px] text-[#8B8B8B] mb-0.5">{t.candidateAi.reasoning}</p>
                  <p className="text-[11px] text-[#585858] leading-snug">{r.reasoning}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkillRow({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  return (
    <div>
      <p className="text-[10px] text-[#8B8B8B] mb-0.5">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((s) => <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded bg-[#F6F6F6] ${cls}`}>{s}</span>)}
      </div>
    </div>
  );
}
