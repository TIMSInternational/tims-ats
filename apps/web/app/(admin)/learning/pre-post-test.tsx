'use client';

interface PrePostTestProps {
  t: { prePostTest: string };
}

const DEMO_ITEMS = [
  { name: 'Seguridad Industrial', pre: 42, post: 87, gain: 45, preColor: 'text-[#DD0C15]', preBarColor: 'bg-[#DD0C15]/40' },
  { name: 'Normativa Aduanera', pre: 38, post: 79, gain: 41, preColor: 'text-[#DD0C15]', preBarColor: 'bg-[#DD0C15]/40' },
  { name: 'Liderazgo Equipos', pre: 51, post: 74, gain: 23, preColor: 'text-amber-500', preBarColor: 'bg-amber-400' },
  { name: 'Excel Logistica', pre: 55, post: 88, gain: 33, preColor: 'text-amber-500', preBarColor: 'bg-amber-400' },
];

export function PrePostTest({ t }: PrePostTestProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 flex-1 max-h-[165px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.prePostTest}</h3>
      <div className="space-y-2.5 overflow-y-auto max-h-[110px]">
        {DEMO_ITEMS.map((item) => (
          <div key={item.name} className="flex items-center gap-3">
            <p className="text-[11px] text-[#333] w-[140px] truncate shrink-0">{item.name}</p>
            <div className="flex items-center gap-1.5 flex-1">
              <div className="flex items-center gap-1">
                <span className={`text-[10px] ${item.preColor} font-medium w-[28px] text-right`}>{item.pre}%</span>
                <div className="w-[60px] h-1.5 bg-[#EDEDED] rounded-full">
                  <div className={`h-full ${item.preBarColor} rounded-full`} style={{ width: `${item.pre}%` }} />
                </div>
              </div>
              <svg className="w-3 h-3 text-green-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <div className="flex items-center gap-1">
                <div className="w-[60px] h-1.5 bg-[#EDEDED] rounded-full">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${item.post}%` }} />
                </div>
                <span className="text-[10px] text-green-600 font-medium w-[28px]">{item.post}%</span>
              </div>
            </div>
            <span className="text-[10px] font-bold text-green-600 shrink-0">+{item.gain}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
