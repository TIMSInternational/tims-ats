'use client';

import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { filterSectionsForScope } from '../../lib/launch-scope';
import { SidebarFrame } from './sidebar-frame';
import type { SidebarProps } from './sidebar';

function useNavSections() {
  const { t } = useI18n();
  const ps = t.platformSidebar;
  // Pilot launch scope hides out-of-scope platform items (lib/launch-scope.ts); no-op otherwise.
  return filterSectionsForScope([
    { label: null, items: [{ href: '/dashboard', label: t.nav.dashboard, icon: 'grid' }] },
    {
      label: ps.platform,
      items: [
        { href: '/platform/organizations', label: ps.organizations, icon: 'building' },
        { href: '/platform/subscriptions', label: ps.subscriptions, icon: 'refresh' },
        { href: '/platform/invoices', label: ps.invoices, icon: 'receipt' },
        { href: '/platform/users', label: ps.users, icon: 'users' },
        { href: '/platform/invitations', label: ps.invitations, icon: 'envelope' },
      ],
    },
    {
      label: ps.system,
      items: [
        { href: '/platform/health', label: ps.systemHealth, icon: 'pulse' },
        { href: '/platform/feature-flags', label: ps.featureFlags, icon: 'flag' },
        { href: '/platform/ai-agents', label: ps.aiAgents, icon: 'brain' },
        { href: '/platform/analytics', label: ps.analytics, icon: 'chart' },
      ],
    },
    {
      label: ps.support,
      items: [
        { href: '/platform/notifications', label: ps.notifications, icon: 'bell' },
        { href: '/platform/audit', label: ps.audit, icon: 'list' },
        { href: '/platform/access-review', label: ps.accessReview, icon: 'shield' },
        { href: '/platform/support', label: ps.supportPage, icon: 'headset' },
      ],
    },
  ]);
}

export function PlatformSidebar({
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
  const sections = useNavSections().map((section) => ({
    label: section.label,
    items: section.items.map((item) => ({
      ...item,
      active: pathname === item.href || pathname.startsWith(item.href + '/'),
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
      roleLabel={t.nav.admin}
      avatar={avatar}
    />
  );
}
