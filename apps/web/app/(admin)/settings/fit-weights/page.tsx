'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Skeleton, ErrorState } from '../../../../components';

const DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;

export default function FitWeightsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [weights, setWeights] = useState<Record<(typeof DIMENSIONS)[number], number>>({
    assessment: 0.2, interview: 0.2, experience: 0.2, education: 0.2, languages: 0.2,
  });

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

  const weightLabels: Record<(typeof DIMENSIONS)[number], string> = {
    assessment: t.fitWeights.weightAssessment,
    interview: t.fitWeights.weightInterview,
    experience: t.fitWeights.weightExperience,
    education: t.fitWeights.weightEducation,
    languages: t.fitWeights.weightLanguages,
  };

  const sum = DIMENSIONS.reduce((s, d) => s + weights[d], 0);

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
                    value={weights[dim]}
                    onChange={(e) => setWeights((w) => ({ ...w, [dim]: Number(e.target.value) }))}
                    className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
                  />
                </div>
              ))}
            </div>
            <p className={`text-[11px] mb-4 ${Math.abs(sum - 1) < 0.001 ? 'text-[#8B8B8B]' : 'text-[#DD0C15]'}`}>
              {t.fitWeights.sumHint} ({sum.toFixed(2)})
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
                  {DIMENSIONS.map((dim) => (
                    <th key={dim} className="text-right pb-2 font-medium">{weightLabels[dim]}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-[#333]">
                {(profiles.data ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-[#F6F6F6]">
                    <td className="py-2.5 font-medium">{p.name}</td>
                    {DIMENSIONS.map((dim) => (
                      <td key={dim} className="py-2.5 text-right">{p.weights[dim]}</td>
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
