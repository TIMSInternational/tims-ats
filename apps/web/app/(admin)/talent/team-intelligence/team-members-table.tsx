'use client';

interface TeamMembersTableProps {
  t: {
    teamMembers: string;
    members: string;
    colName: string;
    colRole: string;
    colPca: string;
    colTenure: string;
    colPerf: string;
  };
}

const DEMO_MEMBERS = [
  { name: 'Carlos Morales', initials: 'CM', avatarBg: 'bg-[#1F114C]', role: 'Tech Lead', pca: 'DI', pcaColor: 'bg-[#DD0C15]/10 text-[#DD0C15]', tenure: '4.2a', perf: 9.1, perfColor: 'text-green-600' },
  { name: 'Maria Restrepo', initials: 'MR', avatarBg: 'bg-[#DD0C15]', role: 'Sr. Developer', pca: 'IS', pcaColor: 'bg-amber-500/10 text-amber-600', tenure: '3.5a', perf: 8.7, perfColor: 'text-green-600' },
  { name: 'Jose Hernandez', initials: 'JH', avatarBg: 'bg-[#5C4B99]', role: 'Sr. Developer', pca: 'DC', pcaColor: 'bg-[#DD0C15]/10 text-[#DD0C15]', tenure: '3.1a', perf: 8.4, perfColor: 'text-green-600' },
  { name: 'Ana Villamizar', initials: 'AV', avatarBg: 'bg-green-600', role: 'Mid Developer', pca: 'SC', pcaColor: 'bg-green-500/10 text-green-600', tenure: '2.8a', perf: 8.0, perfColor: 'text-[#1F114C]' },
  { name: 'Roberto Paredes', initials: 'RP', avatarBg: 'bg-amber-500', role: 'Sr. DevOps', pca: 'CD', pcaColor: 'bg-blue-500/10 text-blue-600', tenure: '3.8a', perf: 8.5, perfColor: 'text-green-600' },
  { name: 'Laura Gutierrez', initials: 'LG', avatarBg: 'bg-blue-500', role: 'Mid Developer', pca: 'ID', pcaColor: 'bg-amber-500/10 text-amber-600', tenure: '2.0a', perf: 7.9, perfColor: 'text-[#1F114C]' },
  { name: 'Diego Alvarez', initials: 'DA', avatarBg: 'bg-[#1F114C]', role: 'Mid QA', pca: 'CS', pcaColor: 'bg-blue-500/10 text-blue-600', tenure: '2.4a', perf: 8.1, perfColor: 'text-[#1F114C]' },
  { name: 'Sofia Cardenas', initials: 'SC', avatarBg: 'bg-[#DD0C15]', role: 'Jr. Developer', pca: 'DI', pcaColor: 'bg-[#DD0C15]/10 text-[#DD0C15]', tenure: '1.2a', perf: 7.6, perfColor: 'text-[#1F114C]' },
  { name: 'Felipe Mendoza', initials: 'FM', avatarBg: 'bg-[#5C4B99]', role: 'Sr. Developer', pca: 'DI', pcaColor: 'bg-[#DD0C15]/10 text-[#DD0C15]', tenure: '3.0a', perf: 8.8, perfColor: 'text-green-600' },
  { name: 'Valentina Pena', initials: 'VP', avatarBg: 'bg-green-600', role: 'Mid Designer', pca: 'SI', pcaColor: 'bg-green-500/10 text-green-600', tenure: '1.8a', perf: 8.2, perfColor: 'text-[#1F114C]' },
  { name: 'Andres Torres', initials: 'AT', avatarBg: 'bg-amber-500', role: 'Jr. Developer', pca: 'IC', pcaColor: 'bg-amber-500/10 text-amber-600', tenure: '0.8a', perf: 7.2, perfColor: 'text-amber-500' },
  { name: 'Camila Rios', initials: 'CR', avatarBg: 'bg-blue-500', role: 'Jr. QA', pca: 'DI', pcaColor: 'bg-[#DD0C15]/10 text-[#DD0C15]', tenure: '0.6a', perf: 7.4, perfColor: 'text-amber-500' },
];

export function TeamMembersTable({ t }: TeamMembersTableProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.teamMembers}</h3>
        <span className="text-[11px] text-[#8B8B8B]">12 {t.members}</span>
      </div>
      <div className="overflow-y-auto max-h-[155px]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#EDEDED]">
              <th className="text-[10px] text-[#8B8B8B] font-medium text-left pb-2 pl-1">{t.colName}</th>
              <th className="text-[10px] text-[#8B8B8B] font-medium text-left pb-2">{t.colRole}</th>
              <th className="text-[10px] text-[#8B8B8B] font-medium text-center pb-2">{t.colPca}</th>
              <th className="text-[10px] text-[#8B8B8B] font-medium text-center pb-2">{t.colTenure}</th>
              <th className="text-[10px] text-[#8B8B8B] font-medium text-center pb-2">{t.colPerf}</th>
            </tr>
          </thead>
          <tbody className="text-[11px]">
            {DEMO_MEMBERS.map((m, i) => (
              <tr key={m.name} className={i < DEMO_MEMBERS.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
                <td className="py-1.5 pl-1">
                  <div className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full ${m.avatarBg} flex items-center justify-center text-white text-[8px] font-bold`}>
                      {m.initials}
                    </div>
                    <span className="text-[#333] font-medium">{m.name}</span>
                  </div>
                </td>
                <td className="text-[#585858]">{m.role}</td>
                <td className="text-center">
                  <span className={`px-1.5 py-0.5 rounded ${m.pcaColor} text-[9px] font-bold`}>{m.pca}</span>
                </td>
                <td className="text-center text-[#585858]">{m.tenure}</td>
                <td className="text-center">
                  <span className={`font-semibold ${m.perfColor}`}>{m.perf}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
