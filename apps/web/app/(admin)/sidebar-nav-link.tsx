'use client';

import Link from 'next/link';
import { NavIcon } from '../../components/nav-icon';

export interface SidebarNavItem {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}

/**
 * One sidebar row for all three shells. The current page is teal (FormMaps identity) AND
 * semibold AND aria-current="page", so the state is never colour alone. The collapsed rail keeps the
 * name as aria-label and tooltip.
 */
const ROW_ACTIVE = 'bg-[var(--chrome-accent-active)] text-white';
const ROW_IDLE = 'text-[var(--chrome-text-secondary)] hover:bg-[var(--chrome-hover)]';
const ICON_ACTIVE = 'text-white';
const ICON_IDLE = 'text-[var(--chrome-text-tertiary)] group-hover:text-[var(--chrome-text-secondary)]';

export function SidebarNavLink({ item, expanded }: { item: SidebarNavItem; expanded: boolean }) {
  const { href, label, icon, active } = item;
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      aria-label={expanded ? undefined : label}
      title={expanded ? undefined : label}
      className={`group flex h-10 items-center gap-2 rounded-[var(--r-sm)] transition-colors duration-150 lg:h-[var(--nav-item-h)] ${
        expanded ? 'px-2' : 'justify-center'
      } ${active ? ROW_ACTIVE : ROW_IDLE}`}
    >
      <NavIcon name={icon} className={`size-4 shrink-0 ${active ? ICON_ACTIVE : ICON_IDLE}`} />
      {expanded && (
        <span
          className={`flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-body ${active ? 'font-semibold' : 'font-medium'}`}
        >
          {label}
        </span>
      )}
    </Link>
  );
}
