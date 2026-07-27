'use client';

import { useI18n } from '../../../../lib/i18n';
import {
  useDeiPromotionEquity,
  useDeiLeadershipDiversity,
  useDeiInclusionIndex,
} from '../../../../lib/platform-api/dei';

const GENDER_BAR: Record<string, string> = {
  male: 'bg-blue-500',
  female: 'bg-pink-500',
  non_binary: 'bg-purple-400',
  undisclosed: 'bg-gray-300',
};

function genderLabel(t: ReturnType<typeof useI18n>['t'], g: string): string {
  return g === 'male'
    ? t.dei.genderMale
    : g === 'female'
      ? t.dei.genderFemale
      : g === 'non_binary'
        ? t.dei.genderNonBinary
        : g === 'undisclosed'
          ? t.dei.genderUndisclosed
          : g;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{title}</h3>
      {children}
    </div>
  );
}

export function PromotionEquity() {
  const { t } = useI18n();
  const q = useDeiPromotionEquity();

  return (
    <Card title={t.dei.promotions}>
      {q.isLoading ? (
        <div className="h-16 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.dei.errPromotions}</p>
      ) : (
        <>
          <p className="text-[24px] font-bold text-[#1F114C]">
            {q.data?.totalPromotions == null ? t.dei.na : q.data.totalPromotions}
          </p>
          <p className="text-[10px] text-[#8B8B8B] mt-1">
            {t.dei.promotionsIn} {q.data?.year}. {t.dei.promotionsBreakdownNote}
          </p>
        </>
      )}
    </Card>
  );
}

export function LeadershipDiversity() {
  const { t } = useI18n();
  const q = useDeiLeadershipDiversity();

  return (
    <Card title={t.dei.leadershipDiversity}>
      {q.isLoading ? (
        <div className="h-24 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.dei.errLeadership}</p>
      ) : !q.data || q.data.byGender.length === 0 ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.dei.noLeaders}</p>
      ) : (
        <>
          <div className="flex h-6 rounded-full overflow-hidden mb-3">
            {q.data.byGender.map((g) => (
              <div
                key={g.gender}
                className={`${GENDER_BAR[g.gender] ?? 'bg-gray-300'}`}
                style={{ width: `${g.percentage ?? 0}%` }}
              />
            ))}
          </div>
          <div className="space-y-1.5">
            {q.data.byGender.map((g) => (
              <div key={g.gender} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2.5 h-2.5 rounded-sm ${GENDER_BAR[g.gender] ?? 'bg-gray-300'}`} />
                  <span className="text-[11px] text-[#333]">{genderLabel(t, g.gender)}</span>
                </div>
                {/* min-5 mask: percentage is nulled when this leader group is sub-floor
                    OR when any sibling is (all-or-nothing differencing guard). */}
                <span className="text-[11px] font-semibold text-[#1F114C]">
                  {g.percentage === null ? t.dei.na : `${g.percentage}%`}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[#8B8B8B] mt-2 pt-2 border-t border-[#F0F0F0]">
            {q.data.totalLeaders ?? t.dei.na} {t.dei.leadersSuffix} · {t.dei.leadershipGoalPrefix}{' '}
            <strong className="text-[#1F114C]">{t.dei.leadershipGoalValue}</strong>
          </p>
        </>
      )}
    </Card>
  );
}

export function InclusionTrend() {
  const { t } = useI18n();
  const q = useDeiInclusionIndex();

  return (
    <Card title={t.dei.inclusionTitle}>
      {q.isLoading ? (
        <div className="h-20 bg-gray-50 rounded animate-pulse" />
      ) : q.isError ? (
        <p className="text-[12px] text-[#DD0C15]">{t.dei.errInclusion}</p>
      ) : q.data?.index === null || q.data?.index === undefined ? (
        <p className="text-[12px] text-[#8B8B8B]">{t.dei.noInclusionSurvey}</p>
      ) : (
        <>
          <p className="text-[32px] font-bold text-green-600">
            {q.data.index}
            <span className="text-[14px] text-[#8B8B8B] font-normal"> / 100</span>
          </p>
          <p className="text-[10px] text-[#8B8B8B] mt-1">
            {t.dei.inclusionResponsesPrefix} {q.data.totalResponses} {t.dei.inclusionResponsesSuffix}
          </p>
        </>
      )}
    </Card>
  );
}
