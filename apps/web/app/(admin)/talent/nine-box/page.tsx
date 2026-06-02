'use client';

import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { KpiCardSkeleton, EmptyState, CandidateAvatar } from '../../../../components';

const CELL_COLORS: Record<string, string> = {
  '3-1': 'bg-amber-50', '3-2': 'bg-blue-50', '3-3': 'bg-emerald-50',
  '2-1': 'bg-red-50', '2-2': 'bg-amber-50', '2-3': 'bg-blue-50',
  '1-1': 'bg-red-100', '1-2': 'bg-red-50', '1-3': 'bg-amber-50',
};

export default function NineBoxPage() {
  const { t } = useI18n();
  const gridData = trpc.ninebox.getGrid.useQuery({ period: new Date().getFullYear().toString() });

  if (gridData.isLoading) {
    return (
      <div className="h-full flex flex-col overflow-hidden p-6">
        <h1 className="text-lg font-semibold text-[#1F114C] mb-5">{t.nineBox.title}</h1>
        <div className="grid grid-cols-3 gap-3">{Array.from({ length: 9 }).map((_, i) => <KpiCardSkeleton key={i} />)}</div>
      </div>
    );
  }

  const grid = gridData.data?.grid ?? {};
  const total = gridData.data?.totalEvaluations ?? 0;

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-semibold text-[#1F114C]">{t.nineBox.title}</h1>
          <p className="text-xs text-[#8B8B8B]">{t.nineBox.subtitle} — {total} {t.nineBox.kpiEvaluated.toLowerCase()}</p>
        </div>
      </div>

      {total === 0 ? (
        <EmptyState icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1" /><line x1="9" y1="3" x2="9" y2="21" /><line x1="15" y1="3" x2="15" y2="21" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /></svg>} message={t.nineBox.noEvaluations} description={t.nineBox.noEvaluationsDesc} />
      ) : (
        <div className="flex gap-2 flex-1">
          <div className="w-16 shrink-0 flex flex-col justify-between py-2">
            <span className="text-[10px] text-[#8B8B8B] font-medium text-right">{t.nineBox.high}</span>
            <span className="text-[10px] text-[#8B8B8B] font-medium text-right">{t.nineBox.medium}</span>
            <span className="text-[10px] text-[#8B8B8B] font-medium text-right">{t.nineBox.low}</span>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-3 gap-2">
              {[3, 2, 1].map((potential) =>
                [1, 2, 3].map((performance) => {
                  const key = `${potential}-${performance}`;
                  const people = grid[key] ?? [];
                  return (
                    <div key={key} className={`${CELL_COLORS[key] ?? 'bg-gray-50'} rounded-xl p-3 min-h-[120px]`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] text-[#8B8B8B] font-medium">P{potential} R{performance}</span>
                        <span className="text-[10px] font-bold text-[#1F114C] bg-white/70 px-1.5 py-0.5 rounded">{people.length}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {people.slice(0, 6).map((ev) => (
                          <CandidateAvatar key={ev.id} firstName={ev.user.firstName} lastName={ev.user.lastName} avatar={ev.user.avatar} size="sm" />
                        ))}
                        {people.length > 6 && <span className="text-[9px] text-[#8B8B8B]">+{people.length - 6}</span>}
                      </div>
                    </div>
                  );
                }),
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-1">
              <span className="text-[10px] text-[#8B8B8B] font-medium text-center">{t.nineBox.low}</span>
              <span className="text-[10px] text-[#8B8B8B] font-medium text-center">{t.nineBox.medium}</span>
              <span className="text-[10px] text-[#8B8B8B] font-medium text-center">{t.nineBox.high}</span>
            </div>
            <p className="text-[10px] text-[#8B8B8B] text-center mt-1">{t.nineBox.performance} →</p>
          </div>
        </div>
      )}
    </div>
  );
}
