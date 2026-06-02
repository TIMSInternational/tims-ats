'use client';

interface MonitoringKpisProps {
  data: {
    totalEmployees: number;
    activeVacancies: number;
    openAlerts: number;
    turnoverRate: number;
  } | null;
  loading: boolean;
}

function KpiSkeleton() {
  return <div className="bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] animate-pulse"><div className="h-14 bg-gray-100 rounded" /></div>;
}

const KPI_ITEMS = [
  { key: 'headcount', label: 'Headcount', value: '1,247', delta: '+18 vs mes anterior', deltaColor: 'text-green-500', valueColor: 'text-[#1F114C]' },
  { key: 'vacantes', label: 'Vacantes Abiertas', value: '23', delta: '5 criticas', deltaColor: 'text-amber-500', valueColor: 'text-[#1F114C]' },
  { key: 'ttf', label: 'Time-to-Fill Prom.', value: '34d', delta: '-6d vs trimestre ant.', deltaColor: 'text-green-500', valueColor: 'text-[#1F114C]' },
  { key: 'rotacion', label: 'Rotacion', value: '8.2%', delta: '+1.1% vs objetivo', deltaColor: 'text-amber-500', valueColor: 'text-amber-500' },
  { key: 'enps', label: 'eNPS', value: '+42', delta: '+5 vs encuesta ant.', deltaColor: 'text-green-500', valueColor: 'text-green-600' },
  { key: 'hrs', label: 'Hrs. Capacitacion', value: '12.4', delta: 'hrs/persona este Q', deltaColor: 'text-green-500', valueColor: 'text-[#1F114C]' },
];

export function MonitoringKpis({ loading }: MonitoringKpisProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-6 gap-3 shrink-0">
        {Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-3 shrink-0">
      {KPI_ITEMS.map((k) => (
        <div key={k.key} className="bg-white rounded-xl p-3.5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] text-center">
          <p className="text-[10px] text-[#8B8B8B] mb-0.5 uppercase tracking-wide">{k.label}</p>
          <p className={`text-[26px] font-bold ${k.valueColor} leading-tight`}>{k.value}</p>
          <p className={`text-[10px] ${k.deltaColor} font-medium mt-0.5`}>{k.delta}</p>
        </div>
      ))}
    </div>
  );
}
