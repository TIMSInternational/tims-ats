'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../lib/i18n';
import { usePermissions } from '../../lib/permissions';
import { manifestFor, computeVisibleSections, resolveLabel, isNavItemActive } from '../../lib/nav/manifest';
import { isNavFeatureOn } from '../../lib/nav/feature-flags';
import { filterSectionsForScope } from '../../lib/launch-scope';
import { NavIcon } from '../../components/nav-icon';

const MAX_TABS = 5;

// Tab labels are single words where possible (tab-bars.md); the full sidebar name stays the accessible name.
function tabLabel(tabLabels: Record<string, string>, labelKey: string): string | undefined {
  return tabLabels[labelKey.split('.').pop() ?? ''];
}

/**
 * Bottom tab bar for the participant shell (employees, committee members) below lg: their 2–5 destinations
 * one tap away instead of behind the hamburger (sidebars.md › Mobile: "Consider using a tab bar first";
 * tab-bars.md: labelled, never hidden). The hamburger stays for the profile menu (Mi perfil, Seguridad,
 * Cerrar sesión).
 */
export function ParticipantTabBar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const { can, roles, isLoading } = usePermissions();
  // prettier-ignore
  const items = computeVisibleSections(filterSectionsForScope(manifestFor(roles).sections), can, isLoading, isNavFeatureOn)
    .flatMap((section) => section.items)
    .filter((item, index, all) => all.findIndex((other) => other.href === item.href) === index)
    .slice(0, MAX_TABS);

  if (items.length < 2) return null;

  return (
    <nav
      aria-label={t.nav.mainNav}
      className="fixed inset-x-0 bottom-0 z-30 grid h-16 auto-cols-fr grid-flow-col border-t border-border bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => {
        const active = isNavItemActive(pathname, item.href);
        const fullLabel = resolveLabel(t, item.labelKey);
        const shortLabel = tabLabel(t.nav.tabLabels, item.labelKey);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            aria-label={shortLabel && shortLabel !== fullLabel ? fullLabel : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-caption transition-colors ${
              active ? 'font-semibold text-brand' : 'text-secondary hover:text-primary'
            }`}
          >
            <NavIcon name={item.icon} className="size-5 shrink-0" />
            <span className="max-w-full truncate">{shortLabel ?? fullLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}
