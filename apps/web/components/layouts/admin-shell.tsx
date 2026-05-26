"use client";

import * as React from "react";
import Link from "next/link";
import {
  Users,
  Briefcase,
  Star,
  Heart,
  Settings,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  FileText,
  Calendar,
  BarChart3,
  Award,
  MessageSquare,
  Building2,
  UserCheck,
  ClipboardList,
  Target,
  Smile,
  TrendingUp,
  Sliders,
  Shield,
  Globe,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@tims/ui";
import { SidebarNav, type NavSection } from "./sidebar-nav";
import { HeaderBar, type HeaderUser } from "./header-bar";

const NAV_SECTIONS: NavSection[] = [
  {
    label: "General",
    icon: <LayoutDashboard />,
    defaultOpen: true,
    items: [
      { label: "Dashboard", href: "/admin", icon: <LayoutDashboard /> },
      { label: "Reportes", href: "/admin/reports", icon: <BarChart3 /> },
    ],
  },
  {
    label: "Reclutamiento",
    icon: <Briefcase />,
    defaultOpen: true,
    items: [
      { label: "Vacantes", href: "/admin/recruitment/jobs", icon: <Briefcase /> },
      { label: "Candidatos", href: "/admin/recruitment/candidates", icon: <Users /> },
      { label: "Solicitudes", href: "/admin/recruitment/applications", icon: <ClipboardList /> },
      { label: "Entrevistas", href: "/admin/recruitment/interviews", icon: <Calendar /> },
      { label: "Ofertas", href: "/admin/recruitment/offers", icon: <FileText /> },
    ],
  },
  {
    label: "Personas",
    icon: <Users />,
    items: [
      { label: "Empleados", href: "/admin/people/employees", icon: <UserCheck /> },
      { label: "Organigramas", href: "/admin/people/org-chart", icon: <Building2 /> },
      { label: "Onboarding", href: "/admin/people/onboarding", icon: <ClipboardList /> },
      { label: "Offboarding", href: "/admin/people/offboarding", icon: <ClipboardList /> },
    ],
  },
  {
    label: "Talento",
    icon: <Star />,
    items: [
      { label: "Evaluaciones", href: "/admin/talent/assessments", icon: <Award /> },
      { label: "Objetivos", href: "/admin/talent/goals", icon: <Target /> },
      { label: "Revisiones", href: "/admin/talent/reviews", icon: <Star /> },
      { label: "Planes de carrera", href: "/admin/talent/career-plans", icon: <TrendingUp /> },
    ],
  },
  {
    label: "Engagement",
    icon: <Heart />,
    items: [
      { label: "Encuestas", href: "/admin/engagement/surveys", icon: <MessageSquare /> },
      { label: "Reconocimientos", href: "/admin/engagement/recognition", icon: <Smile /> },
      { label: "Pulso laboral", href: "/admin/engagement/pulse", icon: <Heart /> },
    ],
  },
  {
    label: "Configuración",
    icon: <Settings />,
    items: [
      { label: "Organización", href: "/admin/settings/organization", icon: <Building2 /> },
      { label: "Usuarios y roles", href: "/admin/settings/users", icon: <Shield /> },
      { label: "Integraciones", href: "/admin/settings/integrations", icon: <Globe /> },
      { label: "Personalización", href: "/admin/settings/customization", icon: <Sliders /> },
    ],
  },
];

export interface AdminShellProps {
  children: React.ReactNode;
  user?: HeaderUser;
}

export function AdminShell({ children, user }: AdminShellProps) {
  const [collapsed, setCollapsed] = React.useState(false);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside
        className={cn(
          "relative flex flex-col border-r border-border bg-card transition-all duration-200 ease-in-out shrink-0",
          collapsed ? "w-[60px]" : "w-60"
        )}
        aria-label="Main navigation"
      >
        {/* Logo / org name */}
        <div
          className={cn(
            "flex h-14 items-center border-b border-border px-4 shrink-0",
            collapsed ? "justify-center px-2" : "gap-3"
          )}
        >
          {/* Logo mark */}
          <Link href="/admin" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            T
          </Link>
          {!collapsed && (
            <span className="font-semibold text-foreground text-sm truncate">TIMS Platform</span>
          )}
        </div>

        {/* Nav scroll area */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          <SidebarNav sections={NAV_SECTIONS} collapsed={collapsed} />
        </div>

        {/* User / org footer */}
        {!collapsed && user && (
          <div className="border-t border-border px-3 py-3 shrink-0">
            <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {user.name.split(" ").slice(0, 2).map((n) => n[0]).join("").toUpperCase()}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-foreground truncate">{user.name}</span>
                <span className="text-[11px] text-muted-foreground truncate">{user.email}</span>
              </div>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-[4.5rem] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-3 w-3" />
          ) : (
            <PanelLeftClose className="h-3 w-3" />
          )}
        </button>
      </aside>

      {/* ── Main content column ──────────────────────────────────────── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <HeaderBar user={user} />

        <main className="flex-1 overflow-y-auto bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
