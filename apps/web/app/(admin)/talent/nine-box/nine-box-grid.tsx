'use client';

import { CandidateAvatar } from '../../../../components';

/* ── Grid cell colour matrix (row-col, top-left = 3-1) ────────────── */
const CELL_BG: Record<string, string> = {
  '3-1': '#F4A539', '3-2': '#FFD44F', '3-3': '#4CAF50',
  '2-1': '#F4A539', '2-2': '#FFD44F', '2-3': '#FFD44F',
  '1-1': '#E53935', '1-2': '#F4A539', '1-3': '#FFD44F',
};

interface Evaluation {
  id: string;
  potentialScore: number;
  performanceScore: number;
  quadrant: string;
  confidence: number;
  user: { id: string; firstName: string; lastName: string; avatar?: string | null; jobTitle?: string | null };
}

interface NineBoxGridProps {
  grid: Record<string, Evaluation[]>;
  allPeople: Evaluation[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
}

/** Convert potential/performance scores (0-5 or 0-100) to % position in the grid */
function toPercent(score: number): number {
  // Scores from DB are 0-5 range (based on seed data)
  const normalized = score <= 5 ? (score / 5) * 100 : score;
  return Math.max(5, Math.min(95, normalized));
}

export function NineBoxGrid({ allPeople, selectedUserId, onSelectUser }: NineBoxGridProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[13px] font-semibold text-[#1F114C]">Nine Box Predictivo TIMS</h2>
        <div className="flex items-center gap-2">
          <select className="text-[11px] border border-[#EDEDED] rounded-lg px-2 h-7 text-[#585858] bg-white">
            <option>Q2 2026</option><option>Q1 2026</option><option>2026</option>
          </select>
          <button className="text-[11px] border border-[#EDEDED] rounded-lg px-2 h-7 text-[#585858] hover:bg-[#F6F6F6] transition">Simulador</button>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Chart area */}
        <div className="flex" style={{ width: 340 }}>
          {/* Y-axis label */}
          <div className="flex flex-col items-center justify-center mr-1" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
            <span className="text-[13px] font-bold text-[#2E75B6] tracking-wider">PCA vs. JCA</span>
          </div>
          {/* Y-axis arrow + grid */}
          <div className="flex flex-col">
            <div className="flex justify-start ml-[1px] mb-[-4px]">
              <svg width="12" height="10" viewBox="0 0 12 10"><polygon points="6,0 0,10 12,10" fill="#2E75B6" /></svg>
            </div>
            <div className="relative border-l-[3px] border-b-[3px] border-[#2E75B6]" style={{ width: 300, height: 300 }}>
              {/* 3x3 colour cells */}
              <div className="grid grid-cols-3 grid-rows-3 gap-[2px] w-full h-full p-[2px]">
                {[3, 2, 1].map((pot) =>
                  [1, 2, 3].map((perf) => {
                    const key = `${pot}-${perf}`;
                    return (
                      <div
                        key={key}
                        className="rounded-lg cursor-pointer hover:opacity-80 transition"
                        style={{ background: CELL_BG[key] }}
                      />
                    );
                  }),
                )}
              </div>

              {/* Scatter dots */}
              {allPeople.map((ev, idx) => {
                const x = toPercent(ev.performanceScore);
                const y = 100 - toPercent(ev.potentialScore);
                const isSelected = ev.user.id === selectedUserId;
                return (
                  <button
                    key={ev.id}
                    onClick={() => onSelectUser(ev.user.id)}
                    className={`absolute flex items-center justify-center w-[26px] h-[26px] rounded-full bg-white border-[2.5px] text-[11px] font-bold shadow-md cursor-pointer z-10 transition-transform ${
                      isSelected ? 'border-[#DD0C15] text-[#DD0C15] scale-125' : 'border-[#2E75B6] text-[#2E75B6]'
                    }`}
                    style={{ left: `calc(${x}% - 13px)`, top: `calc(${y}% - 13px)` }}
                    title={`${ev.user.firstName} ${ev.user.lastName}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}

              {/* X-axis arrow */}
              <div className="absolute" style={{ right: -14, bottom: -5 }}>
                <svg width="10" height="12" viewBox="0 0 10 12"><polygon points="10,6 0,0 0,12" fill="#2E75B6" /></svg>
              </div>
            </div>
            <div className="text-center mt-2">
              <span className="text-[13px] font-bold text-[#2E75B6] tracking-wider">LIA</span>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-col justify-center gap-3 ml-2">
          {[
            { color: '#4CAF50', label: 'Alto Potencial' },
            { color: '#FFD44F', label: 'Potencial Medio' },
            { color: '#F4A539', label: 'Bajo Potencial' },
            { color: '#E53935', label: 'Muy Bajo Potencial' },
          ].map((l) => (
            <div key={l.label} className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full" style={{ background: l.color }} />
              <span className="text-[11px] text-[#333] font-medium">{l.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data table */}
      <div className="mt-4 pt-3 border-t border-[#EDEDED]">
        <table className="w-full text-[11px]">
          <thead>
            <tr>
              <th className="text-center py-2 px-3 bg-[#2E75B6] text-white font-semibold rounded-tl-lg w-[60px]">#</th>
              <th className="text-center py-2 px-3 bg-[#2E75B6] text-white font-semibold">Nombre</th>
              <th className="text-center py-2 px-3 bg-[#2E75B6] text-white font-semibold">JCA vs. PCA</th>
              <th className="text-center py-2 px-3 bg-[#2E75B6] text-white font-semibold rounded-tr-lg">LIA</th>
            </tr>
          </thead>
          <tbody>
            {allPeople.map((ev, idx) => (
              <tr
                key={ev.id}
                onClick={() => onSelectUser(ev.user.id)}
                className={`border-b border-[#EDEDED] cursor-pointer transition-colors ${
                  ev.user.id === selectedUserId ? 'bg-blue-50' : idx % 2 === 1 ? 'bg-[#FAFAFA]' : ''
                } hover:bg-blue-50/60`}
              >
                <td className="text-center py-2 px-3 text-[#333] font-medium">{idx + 1}</td>
                <td className="py-2 px-3 text-[#333]">
                  <div className="flex items-center gap-2 justify-center">
                    <CandidateAvatar firstName={ev.user.firstName} lastName={ev.user.lastName} avatar={ev.user.avatar} size="sm" />
                    <span>{ev.user.firstName} {ev.user.lastName}</span>
                  </div>
                </td>
                <td className="text-center py-2 px-3 text-[#333]">{Math.round(toPercent(ev.potentialScore))}%</td>
                <td className="text-center py-2 px-3 text-[#333]">{Math.round(toPercent(ev.performanceScore))}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
