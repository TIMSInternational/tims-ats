'use client';

import { useI18n } from '../../../../../../lib/i18n';
import type { StaffResultProfile } from '../../../../../../lib/platform-api/assessment-providers-staff';
import { AdvisoryNote, fill, LevelDots } from './chart-parts';

type Pca = NonNullable<StaffResultProfile['pca']>;
type Graph = Pca['graphs'][number];
const FACTORS = ['d', 'i', 's', 'c'] as const;

/** Four columns on a 0–100 scale with the 50 midline; the value is printed above each column. */
function DiscColumns({ graph }: { graph: Graph }) {
  return (
    <svg viewBox="0 0 100 72" className="h-32 w-full" aria-hidden="true">
      <line x1="0" x2="100" y1="34" y2="34" className="stroke-[#C9C4DA]" strokeWidth="0.6" strokeDasharray="2 2" />
      {FACTORS.map((f, i) => {
        const value = graph[f];
        const height = (value / 100) * 50;
        const x = 8 + i * 23;
        return (
          <g key={f}>
            <rect x={x} y={9} width="15" height="50" rx="2" className="fill-[#F4F3F8]" />
            <rect x={x} y={59 - height} width="15" height={height} rx="2" className="fill-[#1F114C]" />
            <text x={x + 7.5} y={57 - height} textAnchor="middle" className="fill-[#1F114C] text-[6px] font-semibold">
              {value}
            </text>
            <text x={x + 7.5} y={69} textAnchor="middle" className="fill-[#333333] text-[6px] font-semibold">
              {f.toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// PCA (DISC): the instrument draws three graphs from the same answers; they sit side by side on one scale, and the
// primary one (behaviour under pressure, as TIMS reads it) carries the only emphasis on the page. The competencies follow
// as levels 1 to 4, named by the provider.
export function PcaProfile({ pca }: { pca: Pca }) {
  const { t } = useI18n();
  const results = t.providerAssessments.results;
  const r = results.pca;
  const graphs: Record<string, string> = r.graphs;

  return (
    <div>
      <p className="text-[12px] text-[#585858]">{r.headline}</p>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {pca.graphs.map((g) => {
          const name = graphs[g.graph] ?? g.graph;
          const primary = g.graph === pca.primaryGraph;
          return (
            <li
              key={g.graph}
              className={`rounded-xl border p-3 ${primary ? 'border-[#1F114C] bg-[#FAF9FD]' : 'border-[#EDEDED] bg-white'}`}
              aria-label={fill(r.graphLabel, { graph: name, d: g.d, i: g.i, s: g.s, c: g.c })}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium text-[#1F114C]">{name}</span>
                {primary && (
                  <span className="shrink-0 rounded-full bg-[#1F114C] px-2 py-0.5 text-[11px] font-medium text-white">
                    {r.primary}
                  </span>
                )}
              </div>
              <DiscColumns graph={g} />
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[12px] text-[#6B6B6B]">
        {FACTORS.map((f) => `${f.toUpperCase()} ${r.factors[f]}`).join(' · ')}
      </p>

      <h4 className="mt-6 text-[13px] font-semibold text-[#1F114C]">{r.competencies}</h4>
      {pca.competencies.length === 0 ? (
        <p className="mt-2 text-[12px] text-[#6B6B6B]">{r.noCompetencies}</p>
      ) : (
        <ul className="mt-2 divide-y divide-[#F1F0F5]">
          {pca.competencies.map((c) => {
            const level = fill(results.levelOf, { value: c.level, max: c.scaleMax });
            return (
              <li
                key={c.code}
                className="flex items-center justify-between gap-4 py-2"
                aria-label={`${c.name}: ${level}`}
              >
                <span className="text-[13px] text-[#333333]">{c.name}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <LevelDots level={c.level} max={c.scaleMax} />
                  <span className="w-20 text-right text-[12px] text-[#585858]">{level}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <AdvisoryNote text={results.advisoryNote} />
    </div>
  );
}
