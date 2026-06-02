'use client';

interface RecommendedHiresProps {
  t: { recommendedHires: string; priority: string };
}

const DEMO_HIRES = [
  {
    profile: 'Perfil Estable',
    badge: 'S',
    badgeColor: 'bg-green-500/10 text-green-600',
    desc: 'Mid Developer con enfoque colaborativo para equilibrar dinamismo.',
    priority: 'Alta',
    priorityColor: 'text-[#DD0C15]',
  },
  {
    profile: 'Perfil Analitico',
    badge: 'CS',
    badgeColor: 'bg-blue-500/10 text-blue-600',
    desc: 'Sr. QA Engineer con pensamiento critico y orientacion al detalle.',
    priority: 'Media',
    priorityColor: 'text-amber-500',
  },
];

export function RecommendedHires({ t }: RecommendedHiresProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.recommendedHires}</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DEMO_HIRES.map((hire) => (
          <div key={hire.profile} className="p-2.5 rounded-lg border border-[#EDEDED] bg-[#F6F6F6]/50">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-1.5 py-0.5 rounded ${hire.badgeColor} text-[9px] font-bold`}>{hire.badge}</span>
              <span className="text-[11px] font-semibold text-[#1F114C]">{hire.profile}</span>
            </div>
            <p className="text-[10px] text-[#585858]">{hire.desc}</p>
            <p className="text-[9px] text-[#8B8B8B] mt-1">
              {t.priority}: <span className={`${hire.priorityColor} font-semibold`}>{hire.priority}</span>
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
