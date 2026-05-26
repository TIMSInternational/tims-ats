"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@tims/ui";

export interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  badge?: string | number;
}

export interface NavSection {
  label: string;
  icon?: React.ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
}

export interface SidebarNavProps {
  sections: NavSection[];
  collapsed: boolean;
}

function NavSection({
  section,
  collapsed,
}: {
  section: NavSection;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(section.defaultOpen ?? false);

  // Auto-open section if any child is active
  React.useEffect(() => {
    const hasActive = section.items.some((item) => pathname.startsWith(item.href));
    if (hasActive) setOpen(true);
  }, [pathname, section.items]);

  return (
    <div className="flex flex-col gap-0.5">
      {/* Section header / toggle */}
      <button
        type="button"
        onClick={() => !collapsed && setOpen((v) => !v)}
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground/70 transition-colors hover:text-muted-foreground",
          collapsed && "justify-center px-2"
        )}
        title={collapsed ? section.label : undefined}
        aria-expanded={!collapsed ? open : undefined}
      >
        {section.icon && (
          <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{section.icon}</span>
        )}
        {!collapsed && (
          <>
            <span className="flex-1 text-left truncate">{section.label}</span>
            {open ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
          </>
        )}
      </button>

      {/* Items */}
      {(open || collapsed) && (
        <div className={cn("flex flex-col gap-0.5", collapsed ? "items-center" : "pl-2")}>
          {section.items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
                aria-current={isActive ? "page" : undefined}
              >
                {item.icon && (
                  <span className="shrink-0 [&_svg]:h-4 [&_svg]:w-4">{item.icon}</span>
                )}
                {!collapsed && (
                  <>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.badge !== undefined && (
                      <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-medium text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                  </>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SidebarNav({ sections, collapsed }: SidebarNavProps) {
  return (
    <nav className="flex flex-col gap-4 px-2 py-3" aria-label="Sidebar navigation">
      {sections.map((section) => (
        <NavSection key={section.label} section={section} collapsed={collapsed} />
      ))}
    </nav>
  );
}
