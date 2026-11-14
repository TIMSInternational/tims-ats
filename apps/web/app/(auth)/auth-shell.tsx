'use client';

import { useI18n } from '../../lib/i18n';
import { isPilotScope } from '../../lib/launch-scope';
import { authHeroPills } from './auth-hero';

// The frame of every sign-in and account-setup screen: the form column is <main> and comes first in the
// DOM, so a screen reader reaches the task before the brand panel (writing.md › Best practices: "put the
// most important information first"); the brand panel is an <aside> shown on the left from lg. Below lg
// one logo header replaces it, the same on every auth page (branding.md › Best practices).
export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pilot = isPilotScope();
  return (
    <div className="flex min-h-dvh">
      <div className="flex flex-1 flex-col bg-surface px-4 sm:px-6">
        <main className="flex w-full flex-1 flex-col items-center justify-center py-10">
          <img src="/logo_tims.png" alt="TIMS International" className="mx-auto mb-6 h-12 w-auto lg:hidden" />
          {children}
        </main>
        <footer className="flex items-center justify-center gap-1.5 pb-6">
          <span className="text-caption text-muted">{t.auth.developedBy}</span>
          <img src="/nexadev-logo.png" alt="" aria-hidden="true" className="h-4.5" />
          <span className="text-callout font-medium text-secondary">NexaDev™</span>
        </footer>
      </div>

      <aside
        aria-label={t.auth.platformName}
        className="relative hidden overflow-hidden bg-brand lg:order-first lg:flex lg:w-[55%]"
      >
        <div className="absolute inset-0 bg-[url('/auth-hero.png')] bg-cover bg-center" />
        {/* Never under 75% navy behind the text, whatever the photo does (accessibility.md › Vision). */}
        <div className="absolute inset-0 bg-gradient-to-t from-brand via-brand/75 to-brand/40" />

        <div className="relative z-10 flex h-full w-full flex-col justify-end p-12 pb-14">
          <img
            src="/logo_tims.png"
            alt="TIMS International"
            className="absolute top-10 left-12 h-20 brightness-0 invert"
          />

          <div>
            <p className="mb-4 text-callout font-semibold tracking-[0.2em] text-white/80 uppercase">
              {t.auth.platformName}
            </p>
            <p className="mb-3 font-display text-4xl leading-tight font-bold tracking-tight text-balance text-white">
              <span className="block">{t.auth.humanCapitalMgmt}</span>
              <span className="block">{t.auth.humanDriving}</span>
              <span className="block text-white/70">{t.auth.growth}</span>
            </p>
            <p className="mb-8 max-w-prose text-subheading leading-relaxed text-white/80">
              {pilot ? t.auth.heroTaglinePilot : t.auth.heroTagline}
            </p>

            {/* Feature pills — only what this launch scope ships */}
            <ul className="mb-10 flex flex-wrap gap-2">
              {authHeroPills().map((key) => (
                <li key={key} className="rounded-full border border-white/25 px-3.5 py-1.5 text-caption text-white/80">
                  {t.auth.heroPills[key]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
    </div>
  );
}
