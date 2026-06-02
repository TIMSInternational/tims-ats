'use client';

import { formatRelativeTime } from '../lib/format-utils';

interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  description: string | null;
  date: Date | string;
  actor: string | null;
}

interface ActivityTimelineProps {
  events: TimelineEvent[];
  maxItems?: number;
}

const TYPE_ICONS: Record<string, { bg: string; icon: 'briefcase' | 'arrow' | 'doc' | 'test' | 'check' }> = {
  application: { bg: 'bg-blue-500', icon: 'briefcase' },
  stage_movement: { bg: 'bg-violet-500', icon: 'arrow' },
  document_uploaded: { bg: 'bg-amber-500', icon: 'doc' },
  assessment_assigned: { bg: 'bg-[#1F114C]', icon: 'test' },
  assessment_completed: { bg: 'bg-emerald-500', icon: 'check' },
};

function Icon({ type }: { type: string }) {
  const cls = 'w-3 h-3 text-white';
  switch (type) {
    case 'briefcase': return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 00-8 0v2" /></svg>;
    case 'arrow': return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M13 7l5 5-5 5M6 12h12" /></svg>;
    case 'doc': return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>;
    case 'test': return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>;
    case 'check': return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
    default: return <svg className={cls} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /></svg>;
  }
}

export function ActivityTimeline({ events, maxItems = 20 }: ActivityTimelineProps) {
  const visible = events.slice(0, maxItems);

  if (visible.length === 0) {
    return <p className="text-xs text-[#8B8B8B] py-4 text-center">No activity yet</p>;
  }

  return (
    <div className="space-y-0">
      {visible.map((event, i) => {
        const cfg = TYPE_ICONS[event.type] ?? { bg: 'bg-gray-400', icon: 'check' as const };
        return (
          <div key={event.id}>
            {i > 0 && <div className="ml-3 w-0.5 h-3 bg-[#EDEDED]" />}
            <div className="flex items-start gap-3">
              <div className={`w-6 h-6 rounded-full ${cfg.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                <Icon type={cfg.icon} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-[#333] font-medium">{event.title}</p>
                {event.description && <p className="text-[11px] text-[#8B8B8B]">{event.description}</p>}
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[#8B8B8B]">{formatRelativeTime(event.date)}</span>
                  {event.actor && <span className="text-[10px] text-[#8B8B8B]">· {event.actor}</span>}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
