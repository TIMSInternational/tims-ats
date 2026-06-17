'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@tims/auth/client';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { Icon } from './sidebar';

// ParticipantSidebar = the lighter, white chrome for participant-shell roles (committee, employee).
// It mirrors Sidebar's manifest-driven rendering loop EXACTLY — the participant manifest decides which
// sections show, computeVisibleSections prunes by can() — but uses a visually distinct light theme so
// the participant surface reads as a different world from the dark admin chrome (mirrors how
// PlatformSidebar is its own component). Reuses the shared Icon SVG switch from sidebar.tsx.
export function ParticipantSidebar({ userInitials, displayName, expanded, onToggle, ready = true, avatar }: {
  userInitials: string;
  displayName: string;
  expanded: boolean;
  onToggle: () => void;
  ready?: boolean;
  avatar?: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  const VISIBLE_SECTIONS = computeVisibleSections(manifestFor(roles).sections, can, isLoading);

  return (
    <aside
      className={`flex flex-col h-full bg-white border-r border-[#ECECEC] shrink-0 overflow-hidden ${
        ready ? 'transition-all duration-300 ease-in-out' : ''
      } ${
        expanded ? 'w-[240px]' : 'w-[72px]'
      }`}
    >
      {/* Logo */}
      <div className={`flex items-center justify-center h-[72px] border-b border-[#ECECEC] shrink-0 ${expanded ? 'px-5' : 'px-0'}`}>
        <Link href="/dashboard" className="flex items-center overflow-hidden">
          {expanded ? (
            <img src="/logo_tims.png" alt="TIMS International" className="h-12" />
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
              <div className="border-t border-[#ECECEC] my-2.5 mx-4" />
            )}
            {expanded && section.labelKey && (
              <p className="text-[10px] uppercase tracking-wider text-[#9A9A9A] font-semibold px-5 mb-1.5 whitespace-nowrap">
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
                        ? 'bg-[#F2F0F9] text-[#1F114C] font-medium'
                        : 'text-[#585858] hover:bg-[#F2F0F9]'
                    }`}
                  >
                    <Icon
                      name={item.icon}
                      className={`w-[20px] h-[20px] shrink-0 ${isActive ? 'text-[#1F114C]' : 'text-[#585858]'}`}
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
      <div className="border-t border-[#ECECEC] shrink-0">
        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          className={`flex items-center gap-3 w-full h-10 transition-colors text-[#9A9A9A] hover:text-[#585858] hover:bg-[#F2F0F9] ${
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
                <p className="text-[12px] text-[#1F114C] font-medium truncate">{displayName}</p>
                <p className="text-[10px] text-[#9A9A9A] truncate">{roleLabel ?? t.nav.admin}</p>
              </div>
              <Link
                href="/mfa"
                title={t.nav.security}
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#9A9A9A] hover:text-[#585858] hover:bg-[#F2F0F9] transition-colors shrink-0"
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
                className="w-8 h-8 rounded-md flex items-center justify-center text-[#9A9A9A] hover:text-[#585858] hover:bg-[#F2F0F9] transition-colors shrink-0"
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
