'use client';

const AGE_DATA = [
  { range: '18-25', count: 42, pct: 18, color: '#B8AED4' },
  { range: '26-35', count: 89, pct: 38, color: '#7B6BAA' },
  { range: '36-45', count: 61, pct: 26, color: '#5C4B99' },
  { range: '46-55', count: 30, pct: 13, color: '#3D2D7A' },
  { range: '55+', count: 12, pct: 5, color: '#1F114C' },
];

const NATIONALITIES = [
  { flag: 'CO', name: 'Colombia', pct: 42, color: '#1F114C' },
  { flag: 'MX', name: 'Mexico', pct: 18, color: '#5C4B99' },
  { flag: 'PE', name: 'Peru', pct: 14, color: '#7B6BAA' },
  { flag: 'CL', name: 'Chile', pct: 11, color: '#B8AED4' },
  { flag: 'AR', name: 'Argentina', pct: 9, color: '#D4CFE5' },
  { flag: 'OT', name: 'Otros (EC, VE, BR)', pct: 6, color: '#E8E5F0' },
];

const FUNNEL = [
  { stage: 'Postulados', pct: 52 },
  { stage: 'Preseleccion', pct: 48 },
  { stage: 'Entrevista', pct: 45 },
  { stage: 'Oferta', pct: 44 },
  { stage: 'Contratado', pct: 46 },
];

export function AgeDistribution() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Distribucion por Edad</h3>
      <div className="space-y-2">
        {AGE_DATA.map((a) => (
          <div key={a.range} className="flex items-center gap-2">
            <span className="text-[11px] text-[#585858] w-12 shrink-0">{a.range}</span>
            <div className="flex-1 bg-[#F6F6F6] rounded-full h-5 overflow-hidden">
              <div className="h-5 rounded-full flex items-center px-2" style={{ width: `${a.pct}%`, backgroundColor: a.color }}>
                {a.pct >= 10 && <span className="text-[9px] text-white font-medium">{a.count}</span>}
              </div>
            </div>
            <span className="text-[10px] text-[#8B8B8B] w-8">{a.pct}%</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#8B8B8B] mt-2 text-center">
        Edad promedio: <strong className="text-[#1F114C]">33.4 anos</strong> | Total: <strong className="text-[#1F114C]">234</strong> empleados
      </p>
    </div>
  );
}

export function NationalityDiversity() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Diversidad por Nacionalidad</h3>
      <div className="space-y-1.5">
        {NATIONALITIES.map((n) => (
          <div key={n.flag} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-[#585858] w-5">{n.flag}</span>
              <span className={`text-[11px] ${n.flag === 'OT' ? 'text-[#8B8B8B]' : 'text-[#333]'}`}>{n.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-24 bg-[#F6F6F6] rounded-full h-3 overflow-hidden">
                <div className="h-3 rounded-full" style={{ width: `${n.pct}%`, backgroundColor: n.color }} />
              </div>
              <span className="text-[11px] font-medium text-[#1F114C] w-8 text-right">{n.pct}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HiringFunnel() {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Embudo de Contratacion Diversa</h3>
      <div className="space-y-1.5">
        {FUNNEL.map((f) => (
          <div key={f.stage} className="flex items-center gap-2">
            <span className="text-[11px] text-[#585858] w-[80px] shrink-0">{f.stage}</span>
            <div className="flex-1 bg-[#F6F6F6] rounded-full h-5 overflow-hidden">
              <div
                className="h-5 rounded-full flex items-center justify-end pr-2"
                style={{ width: `${f.pct}%`, background: 'linear-gradient(90deg,#7B6BAA,#5C4B99)' }}
              >
                <span className="text-[9px] text-white font-medium">{f.pct}%</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#8B8B8B] mt-2 text-center">% candidatos diversos en cada etapa | Meta: &gt;45%</p>
    </div>
  );
}
