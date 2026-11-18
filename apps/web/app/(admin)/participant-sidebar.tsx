'use client';

import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { isNavFeatureOn } from '../../lib/nav/feature-flags';
import { filterSectionsForScope } from '../../lib/launch-scope';
import { SidebarFrame } from './sidebar-frame';
import type { SidebarProps } from './sidebar';

// ParticipantSidebar = the manifest-driven chrome for participant-shell roles (committee, employee). It
// shares the frame with Sidebar (same manifest pruning, same dark-blue chrome); on phones the same items
// also appear in the bottom tab bar (participant-tab-bar.tsx).
export function ParticipantSidebar({
  userInitials,
  displayName,
  expanded,
  onToggle,
  onClose,
  ready = true,
  avatar,
}: SidebarProps) {
  const pathname = usePathname();
  const { t } = useI18n();
  const { can, roles, roleLabel, isLoading } = usePermissions();
  // prettier-ignore
  const visible = computeVisibleSections(filterSectionsForScope(manifestFor(roles).sections), can, isLoading, isNavFeatureOn);
  const sections = visible.map((section) => ({
    label: section.labelKey ? resolveLabel(t, section.labelKey) : null,
    items: section.items.map((item) => ({
      href: item.href,
      label: resolveLabel(t, item.labelKey),
      icon: item.icon,
      active: isNavItemActive(pathname, item.href),
    })),
  }));

  return (
    <SidebarFrame
      sections={sections}
      expanded={expanded}
      onToggle={onToggle}
      onClose={onClose}
      ready={ready}
      userInitials={userInitials}
      displayName={displayName}
      roleLabel={roleLabel ?? t.nav.admin}
      avatar={avatar}
    />
  );
}
