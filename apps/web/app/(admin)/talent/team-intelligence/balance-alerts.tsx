'use client';

interface BalanceAlertsProps {
  t: { balanceAlerts: string; alerts: string };
}

const DEMO_ALERTS = [
  {
    severity: 'high',
    title: 'Exceso de perfil D (42%).',
    body: 'Equipo tiene alta dominancia. Considerar agregar perfiles S para mejorar colaboracion y estabilidad.',
    borderColor: 'border-[#DD0C15]/10',
    bgColor: 'bg-[#DD0C15]/5',
    dotColor: 'bg-[#DD0C15]',
  },
  {
    severity: 'medium',
    title: 'Bajo indice de Cautela (17%).',
    body: 'Pocas personas con perfil analitico. Riesgo de toma de decisiones sin suficiente analisis critico.',
    borderColor: 'border-amber-100',
    bgColor: 'bg-amber-50',
    dotColor: 'bg-amber-500',
  },
  {
    severity: 'medium',
    title: 'Autonomia al 55%.',
    body: 'Equipo depende de liderazgo centralizado. Fomentar independencia con mentoria.',
    borderColor: 'border-amber-100',
    bgColor: 'bg-amber-50',
    dotColor: 'bg-amber-500',
  },
];

export function BalanceAlerts({ t }: BalanceAlertsProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        </svg>
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.balanceAlerts}</h3>
        <span className="ml-auto text-[10px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">
          3 {t.alerts}
        </span>
      </div>
      <div className="space-y-2">
        {DEMO_ALERTS.map((alert, i) => (
          <div key={i} className={`flex items-start gap-2 p-2.5 rounded-lg ${alert.bgColor} border ${alert.borderColor}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${alert.dotColor} mt-1.5 shrink-0`} />
            <p className="text-[11px] text-[#333] leading-relaxed">
              <strong>{alert.title}</strong> {alert.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
