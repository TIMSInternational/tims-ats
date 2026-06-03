'use client';

import { useI18n } from '../../../../lib/i18n';

interface AiRecommendation {
  vacancy: string;
  description: string;
}

// TODO: Wire to real AI recommendations endpoint when ai-gateway is ready
export function TalentPoolAiBar() {
  const { t } = useI18n();

  const recommendations: AiRecommendation[] = [
    { vacancy: 'Sr. Software Engineer', description: `5 ${t.talentPool.poolMatch}` },
    { vacancy: 'DevOps Engineer', description: `3 ${t.talentPool.recontactable}` },
    { vacancy: 'Product Manager', description: `2 ${t.talentPool.internalEligible}` },
  ];

  return (
    <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 mb-4 flex items-start gap-3">
      <svg className="w-5 h-5 text-teal-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
      <div className="flex-1">
        <p className="text-[12px] text-teal-700 font-semibold mb-1">{t.talentPool.aiRecommendations}</p>
        <div className="flex gap-3">
          {recommendations.map((rec) => (
            <div key={rec.vacancy} className="bg-white rounded-lg px-3 py-2 flex-1 border border-teal-200">
              <p className="text-[10px] text-[#8B8B8B]">{t.talentPool.forVacancy} {rec.vacancy}</p>
              <p className="text-[11px] text-teal-700 font-medium">{rec.description}</p>
              <button className="text-[10px] text-[#DD0C15] font-medium mt-1">
                {t.talentPool.viewCandidates} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
