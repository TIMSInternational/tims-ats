'use client';

import { useI18n } from '../../lib/i18n';
import { isPilotScope } from '../../lib/launch-scope';
import { authHeroPills } from './auth-hero';

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const pilot = isPilotScope();
  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand + image */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-[#1F114C] overflow-hidden">
        {/* Background image */}
        <div className="absolute inset-0 bg-cover bg-center bg-[url('/auth-hero.png')]" />
        {/* Gradient overlay — darker at bottom for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1F114C] via-[#1F114C]/60 to-[#1F114C]/40" />

        {/* Content — vertically centered with bottom bias */}
        <div className="relative z-10 flex flex-col justify-end h-full p-12 pb-14">
          {/* Logo — top left absolute */}
          <div className="absolute top-10 left-12">
            <img src="/logo_tims.png" alt="TIMS International" className="h-20 brightness-0 invert" />
          </div>

          {/* Main caption */}
          <div>
            <p className="text-white/60 text-[13px] font-semibold uppercase tracking-[0.2em] mb-4">
              {t.auth.platformName}
            </p>
            <h2 className="text-white text-[36px] font-bold leading-[1.15] mb-3 tracking-tight">
              {t.auth.humanCapitalMgmt}
              <br />
              {t.auth.humanDriving}
              <br />
              <span className="text-white/60">{t.auth.growth}</span>
            </h2>
            <p className="text-white/45 text-[15px] leading-relaxed max-w-[420px] mb-8">
              {pilot ? t.auth.heroTaglinePilot : t.auth.heroTagline}
            </p>

            {/* Feature pills — only what this launch scope ships */}
            <ul className="flex flex-wrap gap-2 mb-10">
              {authHeroPills().map((key) => (
                <li
                  key={key}
                  className="text-[11px] text-white/50 border border-white/15 rounded-full px-3.5 py-1.5 backdrop-blur-sm"
                >
                  {t.auth.heroPills[key]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F6F6F6] px-6">
        <div className="flex-1 flex items-center justify-center w-full">{children}</div>
        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 pb-6">
          <span className="text-[11px] text-[#8B8B8B]">{t.auth.developedBy}</span>
          <img src="/nexadev-logo.png" alt="NexaDev" className="h-[18px]" />
          <span className="text-[12px] font-medium text-[#585858]">NexaDev</span>
          <span className="text-[7px] text-[#8B8B8B] align-super -ml-0.5">TM</span>
        </div>
      </div>
    </div>
  );
}
