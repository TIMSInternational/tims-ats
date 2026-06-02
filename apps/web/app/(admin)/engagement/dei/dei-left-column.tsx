'use client';

const GENDER_DEPTS = [
  { dept: 'Tecnologia', m: 68, f: 28, nb: 4 },
  { dept: 'Operaciones', m: 55, f: 42, nb: 3 },
  { dept: 'RRHH', m: 30, f: 65, nb: 5 },
  { dept: 'Finanzas', m: 52, f: 45, nb: 3 },
  { dept: 'Comercial', m: 60, f: 37, nb: 3 },
  { dept: 'Legal', m: 40, f: 55, nb: 5 },
];

const PAY_EQUITY = [
  { level: 'Junior', salM: '$1,850K COP', salF: '$1,820K COP', gap: '1.6%', color: 'text-green-600', dot: 'bg-green-500' },
  { level: 'Mid', salM: '$3,200K COP', salF: '$3,050K COP', gap: '4.7%', color: 'text-amber-500', dot: 'bg-amber-400' },
  { level: 'Senior', salM: '$5,800K COP', salF: '$5,450K COP', gap: '6.0%', color: 'text-[#DD0C15]', dot: 'bg-[#DD0C15]' },
  { level: 'Lead', salM: '$8,500K COP', salF: '$8,100K COP', gap: '4.7%', color: 'text-amber-500', dot: 'bg-amber-400' },
  { level: 'Director', salM: '$14,200K COP', salF: '$13,200K COP', gap: '7.0%', color: 'text-[#DD0C15]', dot: 'bg-[#DD0C15]' },
];

export function GenderByDepartment() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">Representacion de Genero por Departamento</h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-blue-500" /><span className="text-[10px] text-[#8B8B8B]">Masc</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-pink-400" /><span className="text-[10px] text-[#8B8B8B]">Fem</span></div>
          <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-purple-400" /><span className="text-[10px] text-[#8B8B8B]">NB</span></div>
        </div>
      </div>
      <div className="space-y-2">
        {GENDER_DEPTS.map((d) => (
          <div key={d.dept} className="flex items-center gap-2">
            <span className="text-[11px] text-[#585858] w-[90px] shrink-0 truncate">{d.dept}</span>
            <div className="flex-1 flex h-5 rounded-full overflow-hidden">
              <div className="bg-blue-500 flex items-center justify-center" style={{ width: `${d.m}%` }}>
                {d.m >= 20 && <span className="text-[9px] text-white font-medium">{d.m}%</span>}
              </div>
              <div className="bg-pink-400 flex items-center justify-center" style={{ width: `${d.f}%` }}>
                {d.f >= 20 && <span className="text-[9px] text-white font-medium">{d.f}%</span>}
              </div>
              <div className="bg-purple-400 flex items-center justify-center" style={{ width: `${d.nb}%` }}>
                {d.nb >= 5 && <span className="text-[9px] text-white font-medium">{d.nb}%</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PayEquityTable() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Analisis de Equidad Salarial</h3>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
            <th className="text-left py-2 font-medium">Nivel</th>
            <th className="text-right py-2 font-medium">Salario M</th>
            <th className="text-right py-2 font-medium">Salario F</th>
            <th className="text-right py-2 font-medium">Brecha</th>
            <th className="text-center py-2 font-medium">Estado</th>
          </tr>
        </thead>
        <tbody className="text-[#333]">
          {PAY_EQUITY.map((row, i) => (
            <tr key={row.level} className={i < PAY_EQUITY.length - 1 ? 'border-b border-[#F6F6F6]' : ''}>
              <td className="py-2 font-medium">{row.level}</td>
              <td className="text-right py-2">{row.salM}</td>
              <td className="text-right py-2">{row.salF}</td>
              <td className={`text-right py-2 ${row.color} font-medium`}>{row.gap}</td>
              <td className="text-center py-2"><span className={`inline-block w-2 h-2 rounded-full ${row.dot}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-4 mt-3 pt-2 border-t border-[#F0F0F0]">
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500" /><span className="text-[10px] text-[#8B8B8B]">&lt;3% Equitativo</span></div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-400" /><span className="text-[10px] text-[#8B8B8B]">3-5% Atencion</span></div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#DD0C15]" /><span className="text-[10px] text-[#8B8B8B]">&gt;5% Critico</span></div>
      </div>
    </div>
  );
}
