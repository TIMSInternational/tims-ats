'use client';

interface TeamCompositionProps {
  t: {
    teamComposition: string;
    discDistribution: string;
    gender: string;
    seniority: string;
    male: string;
    female: string;
    srJrRatio: string;
  };
}

const DISC = [
  { label: 'D - Dominancia', pct: 42, count: 5, color: 'bg-[#DD0C15]', text: 'text-[#DD0C15]' },
  { label: 'I - Influencia', pct: 25, count: 3, color: 'bg-amber-500', text: 'text-amber-500' },
  { label: 'S - Estabilidad', pct: 17, count: 2, color: 'bg-green-500', text: 'text-green-500' },
  { label: 'C - Cautela', pct: 17, count: 2, color: 'bg-blue-500', text: 'text-blue-500' },
];

const SENIORITY = [
  { label: 'Senior', count: 4, pct: 33, color: 'bg-[#1F114C]' },
  { label: 'Mid', count: 5, pct: 42, color: 'bg-[#5C4B99]' },
  { label: 'Junior', count: 3, pct: 25, color: 'bg-[#B8AED4]' },
  { label: 'Lead', count: 1, pct: 8, color: 'bg-[#DD0C15]' },
];

export function TeamComposition({ t }: TeamCompositionProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.teamComposition}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* DISC Distribution */}
        <div>
          <p className="text-[11px] font-medium text-[#585858] mb-2">{t.discDistribution}</p>
          <div className="space-y-2">
            {DISC.map((d) => (
              <div key={d.label}>
                <div className="flex justify-between mb-0.5">
                  <span className={`text-[10px] font-semibold ${d.text}`}>{d.label}</span>
                  <span className="text-[10px] font-bold text-[#333]">{d.pct}%</span>
                </div>
                <div className="w-full bg-[#F6F6F6] rounded-full h-3">
                  <div
                    className={`h-3 rounded-full ${d.color} flex items-center pl-1`}
                    style={{ width: `${d.pct}%` }}
                  >
                    <span className="text-[8px] text-white font-medium">{d.count}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Gender */}
        <div>
          <p className="text-[11px] font-medium text-[#585858] mb-2">{t.gender}</p>
          <div className="flex items-end gap-2 h-[100px]">
            <div className="flex flex-col items-center flex-1">
              <span className="text-[10px] font-bold text-[#1F114C] mb-1">58%</span>
              <div className="w-full bg-[#1F114C] rounded-t-md" style={{ height: 58 }} />
              <span className="text-[10px] text-[#585858] mt-1">{t.male}</span>
              <span className="text-[9px] text-[#8B8B8B]">7</span>
            </div>
            <div className="flex flex-col items-center flex-1">
              <span className="text-[10px] font-bold text-[#DD0C15] mb-1">42%</span>
              <div className="w-full bg-[#DD0C15] rounded-t-md" style={{ height: 42 }} />
              <span className="text-[10px] text-[#585858] mt-1">{t.female}</span>
              <span className="text-[9px] text-[#8B8B8B]">5</span>
            </div>
          </div>
        </div>

        {/* Seniority */}
        <div>
          <p className="text-[11px] font-medium text-[#585858] mb-2">{t.seniority}</p>
          <div className="space-y-1.5">
            {SENIORITY.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <span className="text-[10px] text-[#585858] w-14 shrink-0">{s.label}</span>
                <div className="flex-1 bg-[#F6F6F6] rounded-full h-3">
                  <div className={`h-3 rounded-full ${s.color}`} style={{ width: `${s.pct}%` }} />
                </div>
                <span className="text-[10px] font-medium text-[#333] w-4">{s.count}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-[#F0F0F0]">
            <p className="text-[10px] text-[#8B8B8B]">
              {t.srJrRatio}: <span className="font-semibold text-[#1F114C]">1.3:1</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
