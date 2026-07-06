'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { Icon } from './sidebar';
import { SidebarCollapseToggle } from './sidebar-collapse-toggle';
import { SidebarProfileMenu } from './sidebar-profile-menu';

// ParticipantSidebar = the manifest-driven chrome for participant-shell roles (committee, employee).
// It mirrors Sidebar's rendering loop exactly (same manifest, same computeVisibleSections pruning) and,
// as of the FormMaps shell replication, now shares the identical dark-blue chrome — TIMS's 3 sidebar
// variants read as one consistent shell rather than 3 differently-themed surfaces.
export function ParticipantSidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: {
  userInitials: string;
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  ready?: boolean;
  avatar?: string | null;
}) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);

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
        {VISIBLE_SECTIONS.map((section, si) => (
          <div key={si}>
            {expanded && section.labelKey && (
              <p className="text-[10px] uppercase tracking-wider text-[var(--chrome-text-light)] font-semibold px-2 pb-1.5 whitespace-nowrap">
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

      {/* Bottom: profile menu */}
      <div className={`border-t border-[var(--chrome-border-light)] shrink-0 ${expanded ? 'p-2' : 'p-1.5'}`}>
        <SidebarProfileMenu
          userInitials={userInitials}
          displayName={displayName}
          roleLabel={roleLabel ?? t.nav.admin}
          avatar={avatar}
          expanded={expanded}
          securityLabel={t.nav.security}
          logoutLabel={t.nav.logout}
        />
      </div>
    </aside>
  );
}
