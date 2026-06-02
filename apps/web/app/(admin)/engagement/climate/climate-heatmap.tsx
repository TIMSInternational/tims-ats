'use client';

const MOCK_HEATMAP = {
  dimensions: ['Liderazgo', 'Comunicacion', 'Desarrollo', 'Ambiente', 'Reconocimiento', 'Equilibrio'],
  teams: ['Tecnologia', 'Ventas', 'Operaciones', 'RRHH'],
  data: [
    [82, 65, 48, 88],
    [78, 72, 58, 85],
    [90, 60, 55, 76],
    [85, 74, 42, 80],
    [73, 45, 38, 70],
    [80, 62, 52, 82],
  ],
};

function scoreColor(val: number): string {
  if (val >= 70) return '#22c55e';
  if (val >= 50) return '#f59e0b';
  return '#ef4444';
}

export function ClimateHeatmap() {
  const { dimensions, teams, data } = MOCK_HEATMAP;

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#333]">Heatmap por Dimension</h3>
        <span className="text-[10px] text-[#8B8B8B]">Escala 1-100</span>
      </div>
      <table className="w-full text-[11px]">
        <thead>
          <tr>
            <th className="text-left font-medium text-[#8B8B8B] pb-2 w-[140px]">Dimension</th>
            {teams.map((t) => (
              <th key={t} className="text-center font-medium text-[#8B8B8B] pb-2">{t}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dimensions.map((dim, i) => (
            <tr key={dim}>
              <td className="py-1 text-[#333] font-medium">{dim}</td>
              {data[i].map((val, j) => (
                <td key={j} className="text-center">
                  <span
                    className="inline-block w-12 py-1 rounded text-white text-[11px] font-semibold"
                    style={{ backgroundColor: scoreColor(val) }}
                  >
                    {val}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
