'use client';

interface TeamProgressTableProps {
  t: {
    teamProgress: string;
    lastPeriod: string;
    colTeam: string;
    colMembers: string;
    colAvgHours: string;
    colCourses: string;
    colCerts: string;
    colCompleted: string;
  };
}

const DEMO_TEAMS = [
  { name: 'Operaciones Maritimas', members: 42, avgHrs: '16.8h', courses: 12, certs: 34, pct: 92 },
  { name: 'Logistica Terrestre', members: 38, avgHrs: '14.2h', courses: 9, certs: 28, pct: 81 },
  { name: 'Aduanas y Comercio', members: 29, avgHrs: '18.5h', courses: 14, certs: 26, pct: 88 },
  { name: 'Almacenamiento', members: 51, avgHrs: '11.3h', courses: 7, certs: 18, pct: 63 },
  { name: 'Admin & Finanzas', members: 24, avgHrs: '9.7h', courses: 6, certs: 12, pct: 57 },
];

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 70 ? 'bg-green-500' : 'bg-amber-500';
  const textColor = pct >= 70 ? 'text-green-600' : 'text-amber-600';
  return (
    <div className="flex items-center justify-center gap-1.5">
      <div className="w-[50px] h-1.5 bg-[#EDEDED] rounded-full">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-[10px] font-medium ${textColor}`}>{pct}%</span>
    </div>
  );
}

export function TeamProgressTable({ t }: TeamProgressTableProps) {
  return (
    <div className="w-full md:w-[60%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.teamProgress}</h3>
        <span className="text-[10px] text-[#8B8B8B]">{t.lastPeriod}</span>
      </div>
      <table className="w-full text-left">
        <thead>
          <tr className="bg-[#FAFAFA]">
            <th className="text-[11px] text-[#585858] font-medium px-3 py-2 rounded-l-lg">{t.colTeam}</th>
            <th className="text-[11px] text-[#585858] font-medium px-2 py-2 text-center">{t.colMembers}</th>
            <th className="text-[11px] text-[#585858] font-medium px-2 py-2 text-center">{t.colAvgHours}</th>
            <th className="text-[11px] text-[#585858] font-medium px-2 py-2 text-center">{t.colCourses}</th>
            <th className="text-[11px] text-[#585858] font-medium px-2 py-2 text-center">{t.colCerts}</th>
            <th className="text-[11px] text-[#585858] font-medium px-2 py-2 text-center rounded-r-lg">{t.colCompleted}</th>
          </tr>
        </thead>
        <tbody>
          {DEMO_TEAMS.map((team, i) => (
            <tr key={team.name} className={i < DEMO_TEAMS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
              <td className="px-3 py-2.5 text-[11px] text-[#333] font-medium">{team.name}</td>
              <td className="px-2 py-2.5 text-[11px] text-[#585858] text-center">{team.members}</td>
              <td className="px-2 py-2.5 text-[11px] text-[#585858] text-center">{team.avgHrs}</td>
              <td className="px-2 py-2.5 text-[11px] text-[#585858] text-center">{team.courses}</td>
              <td className="px-2 py-2.5 text-[11px] text-[#585858] text-center">{team.certs}</td>
              <td className="px-2 py-2.5 text-center">
                <ProgressBar pct={team.pct} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
