'use client';

import { useI18n } from '../../../../lib/i18n';
import { ErrorState } from '../../../../components';

interface OkrUser {
  id: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
}

interface OkrTeam {
  id: string;
  name: string;
}

export interface OkrItem {
  id: string;
  title: string;
  progress: number;
  user: OkrUser | null;
  team: OkrTeam | null;
}

interface TeamGroup {
  team: string;
  rows: OkrItem[];
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

function getInitials(firstName: string, lastName: string): string {
  return `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase();
}

const AVATAR_COLORS = [
  { bg: 'bg-blue-100', text: 'text-blue-700' },
  { bg: 'bg-purple-100', text: 'text-purple-700' },
  { bg: 'bg-rose-100', text: 'text-rose-700' },
  { bg: 'bg-emerald-100', text: 'text-emerald-700' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700' },
  { bg: 'bg-orange-100', text: 'text-orange-700' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  { bg: 'bg-pink-100', text: 'text-pink-700' },
];

function getAvatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[hash];
}

function groupByTeam(rows: OkrItem[]): TeamGroup[] {
  const map = new Map<string, OkrItem[]>();
  rows.forEach((r) => {
    const teamName = r.team?.name ?? 'Sin equipo';
    const arr = map.get(teamName) || [];
    arr.push(r);
    map.set(teamName, arr);
  });
  return Array.from(map.entries()).map(([team, items]) => ({ team, rows: items }));
}

interface OkrTableProps {
  okrs: OkrItem[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function OkrTable({ okrs, isLoading, isError, onRetry }: OkrTableProps) {
  const { t } = useI18n();

  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="flex gap-3">
            <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
            <div className="h-3 w-16 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="p-5 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <div className="w-6 h-6 rounded-full bg-gray-200 animate-pulse" />
              <div className="h-3 w-28 bg-gray-200 rounded animate-pulse" />
              <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
              <div className="flex-1 h-1.5 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
        <ErrorState onRetry={onRetry} />
      </div>
    );
  }

  const groups = groupByTeam(okrs);
  const alerts = okrs.filter((r) => r.progress < 35);

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
            {alerts.map((a) => {
              const name = a.user ? `${a.user.firstName} ${a.user.lastName}` : 'N/A';
              return `${name} (${a.progress}%)`;
            }).join(' y ')}{' '}
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
      {group.rows.map((row) => {
        const name = row.user ? `${row.user.firstName} ${row.user.lastName}` : 'N/A';
        const initials = row.user ? getInitials(row.user.firstName, row.user.lastName) : '??';
        const color = getAvatarColor(row.id);
        const teamName = row.team?.name ?? '';
        return (
          <tr key={row.id} className="border-b border-[#EDEDED]">
            <td className="px-5 py-2.5">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full ${color.bg} ${color.text} flex items-center justify-center text-[9px] font-bold`}>
                  {initials}
                </div>
                <span className="font-medium">{name}</span>
              </div>
            </td>
            <td className="px-3 py-2.5 text-[#585858]">{teamName}</td>
            <td className="px-3 py-2.5">{row.title}</td>
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
        );
      })}
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
