'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Skeleton, ErrorState } from '../../../../components';
import { isPilotScope } from '../../../../lib/launch-scope';

const ALL_DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;
type Dimension = (typeof ALL_DIMENSIONS)[number];
// Assessments are not part of the pilot: the form does not ask for their weight (it saves 0). The table
// still shows it whenever a listed profile gives it weight (scoring bootstraps "Default" at 20 % each), so
// the columns on screen always add up to what scoring uses.
const PILOT = isPilotScope();
const DIMENSIONS: readonly Dimension[] = PILOT ? ALL_DIMENSIONS.filter((d) => d !== 'assessment') : ALL_DIMENSIONS;
const EVEN_WEIGHT = 1 / DIMENSIONS.length;

/** 0.25 -> "25 %": profiles read as shares of the score, not as raw decimals. */
function formatWeight(weight: number | undefined): string {
  return `${Math.round((weight ?? 0) * 100)} %`;
}

export default function FitWeightsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [weights, setWeights] = useState<Record<Dimension, number>>(() => ({
    assessment: PILOT ? 0 : EVEN_WEIGHT,
    interview: EVEN_WEIGHT,
    experience: EVEN_WEIGHT,
    education: EVEN_WEIGHT,
    languages: EVEN_WEIGHT,
  }));

  const profiles = trpc.fitEngine.listRoleFamilyWeightProfiles.useQuery();

  const upsert = trpc.fitEngine.upsertRoleFamilyWeightProfile.useMutation({
    onSuccess: () => {
      toast(t.fitWeights.saved, { type: 'success' });
      utils.fitEngine.listRoleFamilyWeightProfiles.invalidate();
      setShowForm(false);
      setName('');
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const weightLabels: Record<Dimension, string> = {
    assessment: t.fitWeights.weightAssessment,
    interview: t.fitWeights.weightInterview,
    experience: t.fitWeights.weightExperience,
    education: t.fitWeights.weightEducation,
    languages: t.fitWeights.weightLanguages,
  };

  const sum = DIMENSIONS.reduce((s, d) => s + weights[d], 0);
  const hasStoredAssessmentWeight = (profiles.data ?? []).some((p) => (p.weights.assessment ?? 0) > 0);
  const tableDimensions: readonly Dimension[] = PILOT && hasStoredAssessmentWeight ? ALL_DIMENSIONS : DIMENSIONS;

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.fitWeights.breadcrumb}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.fitWeights.pageTitle}</span>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition"
        >
          {t.fitWeights.createButton}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <p className="text-[12px] text-[#585858] max-w-3xl">{t.fitWeights.explainer}</p>
        {PILOT && hasStoredAssessmentWeight && (
          <p className="text-[12px] text-[#585858] max-w-3xl">{t.fitWeights.pilotStoredAssessmentNote}</p>
        )}
        {showForm && (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.fitWeights.profileName}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.fitWeights.profileNamePlaceholder}
              className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] mb-4 focus:outline-none focus:border-[#1F114C]/40"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
              {DIMENSIONS.map((dim) => (
                <div key={dim}>
                  <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{weightLabels[dim]}</label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={Number(weights[dim].toFixed(2))}
                    onChange={(e) => setWeights((w) => ({ ...w, [dim]: Number(e.target.value) }))}
                    className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
                  />
                </div>
              ))}
            </div>
            <p className={`text-[11px] mb-4 ${Math.abs(sum - 1) < 0.001 ? 'text-[#8B8B8B]' : 'text-[#DD0C15]'}`}>
              {t.fitWeights.sumHint} {formatWeight(sum)}
            </p>
            <button
              onClick={() => upsert.mutate({ name, weights })}
              disabled={upsert.isPending || !name || Math.abs(sum - 1) >= 0.001}
              className="bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
            >
              {t.fitWeights.saveButton}
            </button>
          </div>
        )}

        {profiles.isLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : profiles.isError ? (
          <ErrorState onRetry={() => profiles.refetch()} />
        ) : (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                  <th className="text-left pb-2 font-medium">{t.fitWeights.profileName}</th>
                  {tableDimensions.map((dim) => (
                    <th key={dim} className="text-right pb-2 font-medium">{weightLabels[dim]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[#333]">
                {(profiles.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={tableDimensions.length + 1} className="py-6 text-center text-[#8B8B8B]">
                      {t.fitWeights.empty}
                    </td>
                  </tr>
                )}
                {(profiles.data ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-[#F6F6F6]">
                    <td className="py-2.5 font-medium">{p.name}</td>
                    {tableDimensions.map((dim) => (
                      <td key={dim} className="py-2.5 text-right">{formatWeight(p.weights[dim])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
