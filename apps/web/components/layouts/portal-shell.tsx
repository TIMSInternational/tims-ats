"use client";

import * as React from "react";
import Link from "next/link";
import { Menu, X, Globe, ChevronDown } from "lucide-react";
import { cn } from "@tims/ui";

const NAV_LINKS = [
  { label: "Jobs", href: "/jobs" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
];

export interface PortalShellProps {
  children: React.ReactNode;
  orgName?: string;
  orgLogo?: string;
}

function LanguageToggle() {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState(LANGUAGES[0]);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Select language"
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Globe className="h-4 w-4 shrink-0" />
        <span>{selected.code.toUpperCase()}</span>
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-36 rounded-xl border border-border bg-popover shadow-lg overflow-hidden py-1">
          {LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={() => { setSelected(lang); setOpen(false); }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors hover:bg-muted",
                selected.code === lang.code
                  ? "text-primary font-medium"
                  : "text-foreground"
              )}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PortalShell({ children, orgName = "TIMS", orgLogo }: PortalShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ── Top navbar ──────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5 shrink-0">
            {orgLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={orgLogo} alt={orgName} className="h-8 w-auto object-contain" />
            ) : (
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
                {orgName[0]}
              </span>
            )}
            <span className="font-semibold text-foreground text-base">{orgName}</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Main navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Right actions */}
          <div className="hidden md:flex items-center gap-2">
            <LanguageToggle />

            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Sign in
            </Link>
            <Link
              href="/jobs"
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              View openings
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="flex md:hidden h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-background px-4 py-3 flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-md px-3 py-2.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <div className="flex flex-col gap-2 pt-3 border-t border-border mt-2">
              <LanguageToggle />
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/jobs"
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                View openings
              </Link>
            </div>
          </div>
        )}
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="flex-1">{children}</main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10">
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
            {/* Brand col */}
            <div className="flex flex-col gap-3 max-w-xs">
              <Link href="/" className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-xs">
                  {orgName[0]}
                </span>
                <span className="font-semibold text-foreground">{orgName}</span>
              </Link>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Building great teams through transparent, human-centered hiring.
              </p>
            </div>

            {/* Links grid */}
            <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
              {[
                {
                  title: "Company",
                  links: [
                    { label: "About", href: "/about" },
                    { label: "Contact", href: "/contact" },
                  ],
                },
                {
                  title: "Candidates",
                  links: [
                    { label: "Open positions", href: "/jobs" },
                    { label: "Application status", href: "/status" },
                  ],
                },
                {
                  title: "Legal",
                  links: [
                    { label: "Privacy policy", href: "/privacy" },
                    { label: "Terms of use", href: "/terms" },
                  ],
                },
              ].map((col) => (
                <div key={col.title} className="flex flex-col gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {col.title}
                  </p>
                  {col.links.map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="mt-8 border-t border-border pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} {orgName}. All rights reserved.
            </p>
            <p className="text-xs text-muted-foreground">
              Powered by{" "}
              <span className="font-medium text-foreground">TIMS Platform</span>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
