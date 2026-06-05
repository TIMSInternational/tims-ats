'use client';

interface TeamComparisonProps {
  t: {
    thisTeam: string;
    compare: string;
    balance: string;
    perf: string;
    size: string;
  };
}

const TEAMS = [
  {
    name: 'Tecnologia',
    isCurrent: true,
    balance: 68,
    balanceColor: 'text-amber-500',
    perf: 8.2,
    perfColor: 'text-green-600',
    size: 12,
    disc: [
      { label: 'D', pct: 42, color: 'bg-[#DD0C15]' },
      { label: 'I', pct: 25, color: 'bg-amber-500' },
      { label: 'S', pct: 17, color: 'bg-green-500' },
      { label: 'C', pct: 17, color: 'bg-blue-500' },
    ],
  },
  {
    name: 'Operaciones',
    isCurrent: false,
    balance: 81,
    balanceColor: 'text-green-600',
    perf: 7.9,
    perfColor: 'text-[#1F114C]',
    size: 18,
    disc: [
      { label: 'D', pct: 22, color: 'bg-[#DD0C15]' },
      { label: 'I', pct: 28, color: 'bg-amber-500' },
      { label: 'S', pct: 30, color: 'bg-green-500' },
      { label: 'C', pct: 20, color: 'bg-blue-500' },
    ],
  },
  {
    name: 'Comercial',
    isCurrent: false,
    balance: 74,
    balanceColor: 'text-green-600',
    perf: 8.5,
    perfColor: 'text-green-600',
    size: 9,
    disc: [
      { label: 'D', pct: 30, color: 'bg-[#DD0C15]' },
      { label: 'I', pct: 35, color: 'bg-amber-500' },
      { label: 'S', pct: 15, color: 'bg-green-500' },
      { label: 'C', pct: 20, color: 'bg-blue-500' },
    ],
  },
];

export function TeamComparison({ t }: TeamComparisonProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {TEAMS.map((team) => (
        <div key={team.name} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[12px] font-semibold text-[#1F114C]">{team.name}</h4>
            <span className={`text-[9px] px-2 py-0.5 rounded-full ${team.isCurrent ? 'bg-[#1F114C] text-white' : 'bg-[#F6F6F6] text-[#8B8B8B]'}`}>
              {team.isCurrent ? t.thisTeam : t.compare}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-[10px] text-[#8B8B8B]">{t.balance}</p>
              <p className={`text-[14px] font-bold ${team.balanceColor}`}>{team.balance}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#8B8B8B]">{t.perf}</p>
              <p className={`text-[14px] font-bold ${team.perfColor}`}>{team.perf}</p>
            </div>
            <div>
              <p className="text-[10px] text-[#8B8B8B]">{t.size}</p>
              <p className="text-[14px] font-bold text-[#1F114C]">{team.size}</p>
            </div>
          </div>
          <div className="flex gap-1 mt-2">
            {team.disc.map((d) => (
              <div key={d.label} className={`h-1.5 rounded-full ${d.color}`} style={{ flex: d.pct }} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {team.disc.map((d) => (
              <span key={d.label} className="text-[8px] text-[#8B8B8B]">{d.label}:{d.pct}%</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
