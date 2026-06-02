'use client';

import { useI18n } from '../../../../lib/i18n';

interface OkrRow {
  id: string;
  initials: string;
  avatarBg: string;
  avatarText: string;
  name: string;
  team: string;
  objective: string;
  progress: number;
}

interface TeamGroup {
  team: string;
  rows: OkrRow[];
}

function getProgressColor(pct: number): string {
  if (pct >= 70) return 'bg-green-500';
  if (pct >= 40) return 'bg-amber-400';
  return 'bg-red-500';
}

function getStatusDot(pct: number): string {
  if (pct >= 70) return 'bg-green-500';
  if (pct >= 40) return 'bg-amber-400';
  return 'bg-red-500';
}

const MOCK_DATA: OkrRow[] = [
  { id: '1', initials: 'CR', avatarBg: 'bg-blue-100', avatarText: 'text-blue-700', name: 'Carlos Ramirez', team: 'Logistica', objective: 'Reducir tiempos de entrega 20%', progress: 85 },
  { id: '2', initials: 'MF', avatarBg: 'bg-purple-100', avatarText: 'text-purple-700', name: 'Maria Fernandez', team: 'Logistica', objective: 'Optimizar rutas de distribucion', progress: 52 },
  { id: '3', initials: 'JT', avatarBg: 'bg-rose-100', avatarText: 'text-rose-700', name: 'Jorge Torres', team: 'Logistica', objective: 'Implementar sistema de tracking', progress: 25 },
  { id: '4', initials: 'AG', avatarBg: 'bg-emerald-100', avatarText: 'text-emerald-700', name: 'Andrea Gutierrez', team: 'Comercial', objective: 'Cerrar 15 cuentas nuevas Q2', progress: 93 },
  { id: '5', initials: 'RM', avatarBg: 'bg-cyan-100', avatarText: 'text-cyan-700', name: 'Ricardo Mendoza', team: 'Comercial', objective: 'Incrementar ticket promedio 10%', progress: 61 },
  { id: '6', initials: 'LP', avatarBg: 'bg-orange-100', avatarText: 'text-orange-700', name: 'Laura Paredes', team: 'Operaciones', objective: 'Certificacion ISO 9001 planta', progress: 78 },
  { id: '7', initials: 'DV', avatarBg: 'bg-indigo-100', avatarText: 'text-indigo-700', name: 'Diego Villamizar', team: 'Operaciones', objective: 'Reducir merma al 2%', progress: 30 },
  { id: '8', initials: 'SC', avatarBg: 'bg-pink-100', avatarText: 'text-pink-700', name: 'Sofia Castillo', team: 'Operaciones', objective: 'Capacitar 100% operarios nuevos', progress: 100 },
];

function groupByTeam(rows: OkrRow[]): TeamGroup[] {
  const map = new Map<string, OkrRow[]>();
  rows.forEach((r) => {
    const arr = map.get(r.team) || [];
    arr.push(r);
    map.set(r.team, arr);
  });
  return Array.from(map.entries()).map(([team, rows]) => ({ team, rows }));
}

export function OkrTable() {
  const { t } = useI18n();
  const groups = groupByTeam(MOCK_DATA);
  const alerts = MOCK_DATA.filter((r) => r.progress < 35);

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
        <h3 className="text-[13px] font-semibold text-[#333]">
          {t.performance.okrProgressTitle}
        </h3>
        <div className="flex items-center gap-3">
          <Legend color="bg-green-500" label={t.performance.legendOnTarget} />
          <Legend color="bg-amber-400" label={t.performance.legendAtRisk} />
          <Legend color="bg-red-500" label={t.performance.legendCritical} />
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-[12px]">
        <thead>
          <tr className="bg-[#FAFAFA] text-[11px] text-[#585858] font-medium">
            <th className="text-left px-5 py-2.5">{t.performance.colEmployee}</th>
            <th className="text-left px-3 py-2.5">{t.performance.colTeam}</th>
            <th className="text-left px-3 py-2.5">{t.performance.colObjective}</th>
            <th className="text-left px-3 py-2.5 w-[140px]">{t.performance.colProgress}</th>
            <th className="text-center px-3 py-2.5 w-[50px]">{t.performance.colStatus}</th>
          </tr>
        </thead>
        <tbody className="text-[#333]">
          {groups.map((g) => (
            <TeamRows key={g.team} group={g} />
          ))}
        </tbody>
      </table>

      {/* Alert Row */}
      {alerts.length > 0 && (
        <div className="px-5 py-3 bg-red-50 border-t border-red-100 flex items-center gap-2">
          <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            <path d="M12 15.75h.007v.008H12v-.008z" />
          </svg>
          <span className="text-[11px] text-red-700 font-medium">{t.performance.alertLabel} </span>
          <span className="text-[11px] text-red-600">
            {alerts.map((a) => `${a.name} (${a.progress}%)`).join(' y ')}{' '}
            {t.performance.alertMessage.replace('{names}', '')}
          </span>
        </div>
      )}
    </div>
  );
}

function TeamRows({ group }: { group: TeamGroup }) {
  return (
    <>
      <tr className="bg-[#F6F6F6]">
        <td colSpan={5} className="px-5 py-1.5 text-[10px] font-semibold text-[#1F114C] uppercase tracking-wide">
          {group.team}
        </td>
      </tr>
      {group.rows.map((row) => (
        <tr key={row.id} className="border-b border-[#EDEDED]">
          <td className="px-5 py-2.5">
            <div className="flex items-center gap-2">
              <div className={`w-6 h-6 rounded-full ${row.avatarBg} ${row.avatarText} flex items-center justify-center text-[9px] font-bold`}>
                {row.initials}
              </div>
              <span className="font-medium">{row.name}</span>
            </div>
          </td>
          <td className="px-3 py-2.5 text-[#585858]">{row.team}</td>
          <td className="px-3 py-2.5">{row.objective}</td>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div className="w-full h-1.5 bg-[#EDEDED] rounded-full">
                <div className={`h-full rounded-full ${getProgressColor(row.progress)}`} style={{ width: `${row.progress}%` }} />
              </div>
              <span className="text-[10px] text-[#585858] w-8 text-right">{row.progress}%</span>
            </div>
          </td>
          <td className="px-3 py-2.5 text-center">
            <span className={`w-2.5 h-2.5 rounded-full inline-block ${getStatusDot(row.progress)}`} />
          </td>
        </tr>
      ))}
    </>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-[#8B8B8B]">
      <span className={`w-2 h-2 rounded-full ${color} inline-block`} />
      {label}
    </div>
  );
}
