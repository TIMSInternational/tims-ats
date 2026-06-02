'use client';

const MOCK_AREAS = [
  { name: 'RRHH', score: 80, color: '#22c55e' },
  { name: 'Tecnologia', score: 81, color: '#22c55e' },
  { name: 'Ventas', score: 63, color: '#f59e0b' },
  { name: 'Operaciones', score: 49, color: '#ef4444' },
  { name: 'Logistica', score: 58, color: '#f59e0b' },
  { name: 'Finanzas', score: 74, color: '#22c55e' },
];

export function ClimateResults() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">Resultados por Area</h3>
      <div className="space-y-2.5">
        {MOCK_AREAS.map((area) => (
          <div key={area.name} className="flex items-center gap-3">
            <span className="text-[11px] text-[#585858] w-24 shrink-0">{area.name}</span>
            <div className="flex-1 bg-[#EDEDED] rounded-full h-5 overflow-hidden">
              <div
                className="h-full rounded-full flex items-center pl-2 text-[10px] text-white font-semibold"
                style={{ width: `${area.score}%`, backgroundColor: area.color }}
              >
                {area.score}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
