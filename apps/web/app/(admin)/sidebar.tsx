'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';

export function Icon({ name, className }: { name: string; className: string }) {
  const c = className;
  switch (name) {
    case 'grid':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'briefcase':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a4 4 0 00-8 0v2"/></svg>;
    case 'kanban':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>;
    case 'user':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>;
    case 'clipboard':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>;
    case 'video':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"/></svg>;
    case 'users':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"/></svg>;
    case 'chart':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"/></svg>;
    case 'rocket':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84"/></svg>;
    case 'target':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>;
    case 'book':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"/></svg>;
    case 'ninebox':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/></svg>;
    case 'succession':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"/></svg>;
    case 'team':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M18 21a8 8 0 00-16 0"/><circle cx="10" cy="8" r="5"/><path d="M23 21a6 6 0 00-6-6"/><circle cx="20" cy="8" r="3"/></svg>;
    case 'heart':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/></svg>;
    case 'dei':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m-8-9H3m18 0h-1M5.6 5.6l.7.7m12.4 12.4l-.7-.7M5.6 18.4l.7-.7m12.4-12.4l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>;
    case 'dollar':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>;
    case 'monitor':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z"/><path d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z"/></svg>;
    case 'settings':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z"/><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>;
    default:
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
  }
}

export function Sidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: { userInitials: string; displayName: string; expanded: boolean; onToggle: () => void; ready?: boolean; avatar?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);

  return (
    <aside
      className={`flex flex-col h-full bg-[#1F114C] shrink-0 overflow-hidden ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      } ${
        expanded ? 'w-[240px]' : 'w-[72px]'
      }`}
    >
      {/* Logo */}
      <div className={`flex items-center justify-center h-[72px] border-b border-white/10 shrink-0 ${expanded ? 'px-5' : 'px-0'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-12 brightness-0 invert" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-[#DD0C15] flex items-center justify-center">
              <span className="text-white text-[13px] font-bold">T</span>
            </div>
          )}
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
        {VISIBLE_SECTIONS.map((section, si) => (
          <div key={si}>
            {si > 0 && (
              <div className={`border-t border-white/10 my-2.5 ${expanded ? 'mx-4' : 'mx-4'}`} />
            )}
            {expanded && section.labelKey && (
              <p className="text-[10px] uppercase tracking-wider text-white/30 font-semibold px-5 mb-1.5 whitespace-nowrap">
                {resolveLabel(t, section.labelKey)}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = isNavItemActive(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? resolveLabel(t, item.labelKey) : undefined}
                    className={`group flex items-center gap-3 mx-2 rounded-lg transition-colors h-10 ${
                      expanded ? 'px-3' : 'justify-center'
                    } ${
                      isActive
                        ? 'bg-white/10 text-white'
                        : 'text-white/60 hover:bg-white/[0.07] hover:text-white/80'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-[20px] h-[20px] shrink-0 ${isActive ? 'text-white' : 'text-white/60 group-hover:text-white/80'}`}
                    />
                    {expanded && (
                      <span className={`text-[13px] whitespace-nowrap ${isActive ? 'font-medium' : ''}`}>
                        {resolveLabel(t, item.labelKey)}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: Collapse toggle + User */}
      <div className="border-t border-white/10 shrink-0">
        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className={`flex items-center gap-3 w-full h-10 transition-colors text-white/40 hover:text-white/70 hover:bg-white/[0.05] ${
            expanded ? 'px-5' : 'justify-center'
          }`}
        >
          <svg
            className={`w-[18px] h-[18px] shrink-0 transition-transform duration-300 ${expanded ? '' : 'rotate-180'}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path d="M11 19l-7-7 7-7" />
            <path d="M18 5v14" />
          </svg>
          {expanded && (
            <span className="text-[12px] whitespace-nowrap">{t.nav.collapse}</span>
          )}
        </button>

        {/* User + Logout */}
        <div className={`flex items-center py-3 ${expanded ? 'px-5 gap-3' : 'justify-center'}`}>
          {avatar ? (
            <img src={avatar} alt="" className="w-9 h-9 rounded-full shrink-0 object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#DD0C15] flex items-center justify-center text-white text-[11px] font-bold shrink-0">
              {userInitials}
            </div>
          )}
          {expanded && (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-white font-medium truncate">{displayName}</p>
                <p className="text-[10px] text-white/40 truncate">{roleLabel ?? t.nav.admin}</p>
              </div>
              <Link
                href="/mfa"
                title={t.nav.security}
                className="w-8 h-8 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.07] transition-colors shrink-0"
              >
                <svg className="w-[16px] h-[16px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
                </svg>
              </Link>
              <button
                onClick={async () => {
                  const supabase = createSupabaseBrowserClient();
                  await supabase.auth.signOut();
                  router.push('/login');
                  router.refresh();
                }}
                title={t.nav.logout}
                className="w-8 h-8 rounded-md flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/[0.07] transition-colors shrink-0"
              >
                <svg className="w-[16px] h-[16px]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
