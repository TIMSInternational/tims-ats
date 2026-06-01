'use client';

import { getActivityDotColor, getActivityIconColor, timeAgo } from './dashboard-utils';

function Skeleton({ className }: { className: string }) {
  return <div className={`bg-gray-200 rounded animate-pulse ${className}`} />;
}

function ActivityIcon({ type }: { type: string }) {
  const colorClass = getActivityIconColor(type);
  switch (type) {
    case 'org_created':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M3 21h18M3 7v14m6-14v14m6-14v14m6-14v14M3 7l9-4 9 4" />
        </svg>
      );
    case 'plan_upgrade':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case 'payment_failed':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" />
        </svg>
      );
    case 'user_created':
    case 'platform_owner':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" />
        </svg>
      );
    case 'trial_expiring':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" />
        </svg>
      );
    case 'bulk_users':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" />
        </svg>
      );
    case 'onboarding_complete':
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" />
        </svg>
      );
    default:
      return (
        <svg className={`w-4 h-4 ${colorClass} flex-shrink-0 mt-0.5`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        </svg>
      );
  }
}

interface ActivityItem {
  id: string;
  type: string;
  title: string;
  timestamp: string | Date;
  meta?: string | null;
}

export function RecentActivity({ data, isLoading }: { data?: ActivityItem[]; isLoading: boolean }) {
  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-[#333]">Actividad Reciente</h3>
        <button className="text-xs text-[#1F114C] font-medium hover:underline">Ver todo</button>
      </div>
      {isLoading ? (
        <div className="space-y-3.5 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="space-y-3.5">
          {data.map((item) => (
            <div key={item.id} className="flex items-start gap-3">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${getActivityDotColor(item.type)}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#333]">
                  <span className="font-medium">{item.title.replace(/^(Nueva organizacion: |Nuevo usuario: )/, '')}</span>
                  {item.type === 'org_created' && ' se registro como nueva organizacion'}
                  {item.type === 'user_created' && ' se registro como nuevo usuario'}
                  {item.type === 'platform_owner' && ' se registro como administrador'}
                  {item.type === 'plan_upgrade' && ' actualizo su plan'}
                  {item.type === 'payment_failed' && ' — pago fallido de suscripcion'}
                  {item.type === 'trial_expiring' && ' — trial vence pronto'}
                  {item.type === 'bulk_users' && ' agrego usuarios nuevos'}
                  {item.type === 'onboarding_complete' && ' completo configuracion inicial'}
                </p>
                <p className="text-xs text-[#8B8B8B] mt-0.5">
                  {timeAgo(item.timestamp)}{item.meta ? ` — ${item.meta}` : ''}
                </p>
              </div>
              <ActivityIcon type={item.type} />
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#8B8B8B] text-center py-8">No hay actividad reciente</p>
      )}
    </div>
  );
}
