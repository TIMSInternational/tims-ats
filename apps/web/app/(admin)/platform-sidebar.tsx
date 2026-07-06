'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarProfileMenu } from './sidebar-profile-menu';

function useNavSections() {
  const { t } = useI18n();
  const ps = t.platformSidebar;
  return [
    { label: null, items: [
      { href: '/dashboard', label: t.nav.dashboard, icon: 'grid' },
    ]},
    { label: ps.platform, items: [
      { href: '/platform/organizations', label: ps.organizations, icon: 'building' },
      { href: '/platform/subscriptions', label: ps.subscriptions, icon: 'refresh' },
      { href: '/platform/invoices', label: ps.invoices, icon: 'receipt' },
      { href: '/platform/users', label: ps.users, icon: 'users' },
      { href: '/platform/invitations', label: ps.invitations, icon: 'envelope' },
    ]},
    { label: ps.system, items: [
      { href: '/platform/health', label: ps.systemHealth, icon: 'pulse' },
      { href: '/platform/feature-flags', label: ps.featureFlags, icon: 'flag' },
      { href: '/platform/ai-agents', label: ps.aiAgents, icon: 'brain' },
      { href: '/platform/analytics', label: ps.analytics, icon: 'chart' },
    ]},
    { label: ps.support, items: [
      { href: '/platform/notifications', label: ps.notifications, icon: 'bell' },
      { href: '/platform/audit', label: ps.audit, icon: 'clipboard' },
      { href: '/platform/support', label: ps.supportPage, icon: 'headset' },
    ]},
  ];
}

function Icon({ name, className }: { name: string; className: string }) {
  const c = className;
  switch (name) {
    case 'grid':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
    case 'building':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" /></svg>;
    case 'creditcard':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" /></svg>;
    case 'users':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 19c0-2.21-2.686-4-6-4s-6 1.79-6 4" /><circle cx="9" cy="9" r="3.5" /><path d="M20 19c0-1.657-1.343-3-3-3-.825 0-1.572.336-2.112.879" /><circle cx="17" cy="10.5" r="2.5" /></svg>;
    case 'pulse':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 12h3l3-9 4 18 3-9h5" /></svg>;
    case 'flag':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M5 4h14l-3 4 3 4H5V4z" /><path d="M5 2v20" /></svg>;
    case 'brain':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" /></svg>;
    case 'chart':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>;
    case 'shield':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>;
    case 'bell':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /></svg>;
    case 'headset':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M20 16v-6a8 8 0 10-16 0v6" /><path d="M4 16a2 2 0 01-2-2v-2a2 2 0 012-2h1v6H4zM20 16a2 2 0 002-2v-2a2 2 0 00-2-2h-1v6h1z" /><path d="M18 20a2 2 0 01-2 2h-3" /></svg>;
    case 'receipt':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 3h18v18l-2-1.5L17 21l-2-1.5L13 21l-2-1.5L9 21l-2-1.5L5 21l-2-1.5V3z" /><path d="M9 8h6M9 12h6M9 16h3" /></svg>;
    case 'envelope':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>;
    case 'refresh':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>;
    case 'clipboard':
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
    default:
      return <svg className={c} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>;
  }
}

export function PlatformSidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: {
  userInitials: string;
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  ready?: boolean;
  avatar?: string | null;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const NAV_SECTIONS = useNavSections();

  return (
    <aside
      className={`tims-sidebar flex flex-col h-full bg-[var(--chrome-bg)] shrink-0 overflow-hidden ${
        expanded ? 'w-[var(--sidebar-w-expanded)]' : 'w-[var(--sidebar-w-collapsed)]'
      } ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      }`}
    >
      {/* Logo bar */}
      <div className={`flex items-center justify-between shrink-0 ${expanded ? 'px-3.5 py-3' : 'px-1.5 py-3 justify-center'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-7 brightness-0 invert" />
          ) : (
            <div className="w-7 h-7 rounded-[var(--r-md)] bg-[#DD0C15] flex items-center justify-center">
              <span className="text-white text-[12px] font-bold">T</span>
            </div>
          )}
        </Link>
        {expanded && <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />}
      </div>
      {!expanded && (
        <div className="flex justify-center pb-2">
          <SidebarCollapseToggle expanded={expanded} onToggle={onToggle} collapseLabel={t.nav.collapse} expandLabel={t.nav.expand} />
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 py-1 px-2 flex flex-col gap-2 overflow-y-auto overflow-x-hidden">
        {NAV_SECTIONS.map((section, si) => (
          <div key={si}>
            {expanded && section.label && (
              <p className="text-[10px] uppercase tracking-wider text-[var(--chrome-text-light)] font-semibold px-2 pb-1.5 whitespace-nowrap">
                {section.label}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={!expanded ? item.label : undefined}
                    className={`group flex items-center gap-2 h-[var(--nav-item-h)] rounded-[var(--r-sm)] transition-colors ${
                      expanded ? 'px-2' : 'justify-center'
                    } ${
                      isActive ? 'bg-[var(--chrome-accent-active)]' : 'hover:bg-[var(--chrome-hover)]'
                    } ${
                      isActive ? 'text-white' : 'text-[var(--chrome-text-secondary)]'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-[var(--chrome-text-tertiary)]'} ${
                        isActive ? '' : 'group-hover:text-[var(--chrome-text-secondary)]'
                      }`}
                    />
                    {expanded && (
                      <span className="text-[13px] font-medium whitespace-nowrap flex-1 overflow-hidden text-ellipsis">
                        {item.label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom: profile menu */}
      <div className={`border-t border-[var(--chrome-border-light)] shrink-0 ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={t.nav.admin}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
