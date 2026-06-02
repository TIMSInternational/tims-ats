'use client';

interface ModuleCardData {
  name: string;
  status: 'Saludable' | 'Atencion' | 'Critico';
  metrics: { label: string; value: string; color?: string }[];
  dotColor: string;
  badgeCls: string;
  sparkColor: string;
  sparkPoints: string;
  trendIcon: 'up' | 'flat' | 'down';
}

const MODULES: ModuleCardData[] = [
  {
    name: 'Reclutamiento', status: 'Saludable',
    metrics: [{ label: 'Pipeline Activo', value: '142 candidatos' }, { label: 'Tasa Conversion', value: '18.3%' }],
    dotColor: 'bg-green-400', badgeCls: 'text-green-600 bg-green-50',
    sparkColor: '#22c55e', sparkPoints: '0,18 20,16 40,14 60,12 80,10 100,8 120,6', trendIcon: 'up',
  },
  {
    name: 'Onboarding', status: 'Atencion',
    metrics: [{ label: 'En Proceso', value: '8 personas' }, { label: 'Completacion 90d', value: '74%', color: 'text-amber-500' }],
    dotColor: 'bg-amber-400', badgeCls: 'text-amber-600 bg-amber-50',
    sparkColor: '#f59e0b', sparkPoints: '0,10 20,12 40,10 60,14 80,12 100,14 120,16', trendIcon: 'flat',
  },
  {
    name: 'Performance', status: 'Saludable',
    metrics: [{ label: 'Eval. Completadas', value: '92%' }, { label: 'Rating Promedio', value: '3.8 / 5.0' }],
    dotColor: 'bg-green-400', badgeCls: 'text-green-600 bg-green-50',
    sparkColor: '#22c55e', sparkPoints: '0,20 20,18 40,16 60,14 80,10 100,8 120,6', trendIcon: 'up',
  },
  {
    name: 'L&D / Capacitacion', status: 'Saludable',
    metrics: [{ label: 'Cursos Activos', value: '14' }, { label: 'Completacion', value: '81%' }],
    dotColor: 'bg-green-400', badgeCls: 'text-green-600 bg-green-50',
    sparkColor: '#22c55e', sparkPoints: '0,16 20,14 40,14 60,12 80,10 100,8 120,6', trendIcon: 'up',
  },
  {
    name: 'Talento / Sucesion', status: 'Critico',
    metrics: [{ label: 'Roles Criticos', value: '2 sin sucesor', color: 'text-[#DD0C15]' }, { label: 'Cobertura', value: '68%' }],
    dotColor: 'bg-[#DD0C15]', badgeCls: 'text-red-600 bg-red-50',
    sparkColor: '#ef4444', sparkPoints: '0,8 20,10 40,10 60,12 80,14 100,16 120,18', trendIcon: 'down',
  },
  {
    name: 'Engagement', status: 'Atencion',
    metrics: [{ label: 'eNPS Global', value: '+42' }, { label: 'Participacion Enc.', value: '67%', color: 'text-amber-500' }],
    dotColor: 'bg-amber-400', badgeCls: 'text-amber-600 bg-amber-50',
    sparkColor: '#f59e0b', sparkPoints: '0,12 20,10 40,12 60,14 80,12 100,12 120,14', trendIcon: 'flat',
  },
];

export function ModuleHealthGrid() {
  return (
    <div className="flex-1 min-w-0">
      <div className="grid grid-cols-3 gap-3 h-full">
        {MODULES.map((m) => (
          <div key={m.name} className="bg-white rounded-xl p-4 shadow-[0_1px_4px_rgba(0,0,0,0.06)] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${m.dotColor}`} />
                  <span className="text-[13px] font-semibold text-[#333]">{m.name}</span>
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${m.badgeCls}`}>{m.status}</span>
              </div>
              <div className="space-y-1.5">
                {m.metrics.map((met) => (
                  <div key={met.label} className="flex justify-between">
                    <span className="text-[11px] text-[#8B8B8B]">{met.label}</span>
                    <span className={`text-[11px] font-semibold ${met.color ?? 'text-[#333]'}`}>{met.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 mt-2">
              <svg className="w-full h-6" viewBox="0 0 120 24">
                <polyline fill="none" stroke={m.sparkColor} strokeWidth="1.5" points={m.sparkPoints} />
              </svg>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
