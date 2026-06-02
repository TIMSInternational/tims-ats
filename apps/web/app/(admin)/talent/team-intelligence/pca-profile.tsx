'use client';

interface PcaProfileProps {
  t: { pcaProfile: string; groupAverage: string };
}

const DIMENSIONS = [
  { label: 'Dinamismo', value: 88, color: 'bg-[#1F114C]' },
  { label: 'Solidez', value: 82, color: 'bg-[#5C4B99]' },
  { label: 'Influencia', value: 65, color: 'bg-[#7B6BAA]' },
  { label: 'Cautela', value: 72, color: 'bg-[#B8AED4]' },
  { label: 'Autonomia', value: 55, color: 'bg-amber-400' },
  { label: 'Adaptabilidad', value: 78, color: 'bg-[#D4CFE5]' },
];

export function PcaProfile({ t }: PcaProfileProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.pcaProfile}</h3>
        <span className="text-[11px] text-[#8B8B8B]">{t.groupAverage}</span>
      </div>
      <div className="flex items-center gap-6">
        {/* Radar Chart */}
        <div className="relative w-[260px] h-[260px] shrink-0">
          <svg viewBox="0 0 260 260" className="absolute inset-0 w-full h-full">
            <polygon points="130,15 225,62 225,198 130,245 35,198 35,62" fill="none" stroke="#EDEDED" strokeWidth="1" />
            <polygon points="130,45 200,77 200,183 130,215 60,183 60,77" fill="none" stroke="#EDEDED" strokeWidth="1" />
            <polygon points="130,75 175,92 175,168 130,185 85,168 85,92" fill="none" stroke="#EDEDED" strokeWidth="1" />
            <polygon points="130,105 150,112 150,148 130,155 110,148 110,112" fill="none" stroke="#EDEDED" strokeWidth="1" />
            <line x1="130" y1="130" x2="130" y2="15" stroke="#EDEDED" strokeWidth="0.5" />
            <line x1="130" y1="130" x2="225" y2="62" stroke="#EDEDED" strokeWidth="0.5" />
            <line x1="130" y1="130" x2="225" y2="198" stroke="#EDEDED" strokeWidth="0.5" />
            <line x1="130" y1="130" x2="130" y2="245" stroke="#EDEDED" strokeWidth="0.5" />
            <line x1="130" y1="130" x2="35" y2="198" stroke="#EDEDED" strokeWidth="0.5" />
            <line x1="130" y1="130" x2="35" y2="62" stroke="#EDEDED" strokeWidth="0.5" />
            <polygon points="130,35 210,75 195,190 130,210 55,170 60,78" fill="rgba(31,17,76,0.12)" stroke="#1F114C" strokeWidth="2" />
            <circle cx="130" cy="35" r="4" fill="#1F114C" />
            <circle cx="210" cy="75" r="4" fill="#1F114C" />
            <circle cx="195" cy="190" r="4" fill="#1F114C" />
            <circle cx="130" cy="210" r="4" fill="#1F114C" />
            <circle cx="55" cy="170" r="4" fill="#1F114C" />
            <circle cx="60" cy="78" r="4" fill="#1F114C" />
          </svg>
          <span className="absolute top-[2px] left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#1F114C]">Dinamismo</span>
          <span className="absolute top-[52px] right-[2px] text-[10px] font-semibold text-[#1F114C]">Solidez</span>
          <span className="absolute bottom-[52px] right-[2px] text-[10px] font-semibold text-[#1F114C]">Influencia</span>
          <span className="absolute bottom-[2px] left-1/2 -translate-x-1/2 text-[10px] font-semibold text-[#1F114C]">Cautela</span>
          <span className="absolute bottom-[52px] left-[2px] text-[10px] font-semibold text-[#1F114C]">Autonomia</span>
          <span className="absolute top-[52px] left-[2px] text-[10px] font-semibold text-[#1F114C]">Adaptabilidad</span>
        </div>

        {/* Score Breakdown */}
        <div className="flex-1 space-y-2.5">
          {DIMENSIONS.map((dim) => (
            <div key={dim.label}>
              <div className="flex justify-between mb-1">
                <span className="text-[11px] text-[#585858]">{dim.label}</span>
                <span className="text-[11px] font-semibold text-[#1F114C]">{dim.value}%</span>
              </div>
              <div className="w-full bg-[#F6F6F6] rounded-full h-2">
                <div className={`h-2 rounded-full ${dim.color}`} style={{ width: `${dim.value}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
