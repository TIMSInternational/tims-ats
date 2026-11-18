'use client';

import {
  Radar,
  RadarChart as RechartsRadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from 'recharts';

export interface RadarChartDimension {
  label: string;
  score: number | null;
}

export function RadarChart({ dimensions }: { dimensions: RadarChartDimension[] }) {
  const data = dimensions.map((d) => ({ dimension: d.label, score: d.score ?? 0 }));

  return (
    <div className="w-full h-64">
      <ResponsiveContainer width="100%" height="100%">
        <RechartsRadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="#EDEDED" />
          <PolarAngleAxis dataKey="dimension" tick={{ fill: '#585858', fontSize: 11 }} />
          {/* Scale ticks: the muted text token (#6b6b6b, 5.3:1 on white) at the 11px floor, not #B8B8B8 at 9px. */}
          <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'var(--color-muted)', fontSize: 11 }} tickCount={5} />
          <Radar dataKey="score" stroke="#DD0C15" fill="#DD0C15" fillOpacity={0.25} />
        </RechartsRadarChart>
      </ResponsiveContainer>
    </div>
  );
}
