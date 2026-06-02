'use client';

const WORDS = [
  { text: 'crecimiento', size: 'text-[22px]', weight: 'font-bold', color: 'text-[#1F114C]' },
  { text: 'flexibilidad', size: 'text-[14px]', weight: 'font-semibold', color: 'text-[#22c55e]' },
  { text: 'liderazgo', size: 'text-[18px]', weight: 'font-bold', color: 'text-[#1F114C]' },
  { text: 'estres', size: 'text-[12px]', weight: 'font-medium', color: 'text-[#ef4444]' },
  { text: 'equipo', size: 'text-[16px]', weight: 'font-semibold', color: 'text-[#22c55e]' },
  { text: 'comunicacion', size: 'text-[20px]', weight: 'font-bold', color: 'text-[#f59e0b]' },
  { text: 'burocracia', size: 'text-[11px]', weight: '', color: 'text-[#8B8B8B]' },
  { text: 'innovacion', size: 'text-[15px]', weight: 'font-semibold', color: 'text-[#22c55e]' },
  { text: 'sobrecarga', size: 'text-[13px]', weight: 'font-medium', color: 'text-[#ef4444]' },
  { text: 'reconocimiento', size: 'text-[17px]', weight: 'font-bold', color: 'text-[#1F114C]' },
  { text: 'salario', size: 'text-[12px]', weight: 'font-medium', color: 'text-[#585858]' },
  { text: 'autonomia', size: 'text-[14px]', weight: 'font-semibold', color: 'text-[#22c55e]' },
  { text: 'micromanagement', size: 'text-[11px]', weight: '', color: 'text-[#8B8B8B]' },
  { text: 'proposito', size: 'text-[16px]', weight: 'font-semibold', color: 'text-[#1F114C]' },
  { text: 'capacitacion', size: 'text-[13px]', weight: 'font-medium', color: 'text-[#f59e0b]' },
  { text: 'horarios', size: 'text-[11px]', weight: '', color: 'text-[#585858]' },
];

const SENTIMENT = { positive: 62, neutral: 24, negative: 14, total: 534 };

const ALERTS = [
  { area: 'Operaciones', dim: 'Reconocimiento', score: 38, delta: -12, severity: 'Critico' as const },
  { area: 'Operaciones', dim: 'Ambiente', score: 42, delta: -8, severity: 'Critico' as const },
  { area: 'Ventas', dim: 'Reconocimiento', score: 45, delta: -5, severity: 'Atencion' as const },
];

export function WordCloud() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">Nube de Palabras</h3>
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 py-2">
        {WORDS.map((w) => (
          <span key={w.text} className={`${w.size} ${w.weight} ${w.color}`}>{w.text}</span>
        ))}
      </div>
    </div>
  );
}

export function SentimentAnalysis() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#333]">Analisis de Sentimiento</h3>
        <span className="text-[10px] text-green-500 font-medium flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" /></svg>
          +4% positivo
        </span>
      </div>
      <div className="flex items-center gap-5">
        <div className="relative w-[100px] h-[100px] shrink-0">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#22c55e" strokeWidth="3.5" strokeDasharray="62 38" strokeDashoffset="0" />
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f59e0b" strokeWidth="3.5" strokeDasharray="24 76" strokeDashoffset="-62" />
            <circle cx="18" cy="18" r="15.915" fill="none" stroke="#ef4444" strokeWidth="3.5" strokeDasharray="14 86" strokeDashoffset="-86" />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[11px] font-bold text-[#333]">{SENTIMENT.total}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {[
            { label: 'Positivo', pct: SENTIMENT.positive, cls: 'bg-green-500' },
            { label: 'Neutral', pct: SENTIMENT.neutral, cls: 'bg-amber-400' },
            { label: 'Negativo', pct: SENTIMENT.negative, cls: 'bg-red-500' },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${s.cls}`} />
                <span className="text-[11px] text-[#333]">{s.label}</span>
              </div>
              <span className="text-[12px] font-semibold text-[#333]">{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LowClimateAlerts() {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <h3 className="text-[13px] font-semibold text-[#333] mb-3">Alertas por Bajo Clima</h3>
      <div className="space-y-2">
        {ALERTS.map((a, i) => {
          const isCrit = a.severity === 'Critico';
          return (
            <div key={i} className={`flex items-center justify-between p-2.5 rounded-lg border ${isCrit ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
              <div>
                <p className="text-[12px] font-medium text-[#333]">{a.area} -- {a.dim}</p>
                <p className="text-[10px] text-[#8B8B8B]">Score: {a.score} / 100 | {a.delta} vs anterior</p>
              </div>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${isCrit ? 'text-red-600 bg-red-100' : 'text-amber-600 bg-amber-100'}`}>
                {a.severity}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
