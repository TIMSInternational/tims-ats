'use client';

import { useI18n } from '../../lib/i18n';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-screen">
      {/* Left panel — brand + image */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-[#1F114C] overflow-hidden">
        {/* Background image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/auth-hero.png')" }}
        />
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
            <h2 className="text-white text-[36px] font-bold leading-[1.15] mb-3 tracking-tight">
              {t.auth.humanCapitalMgmt}<br />{t.auth.humanDriving}<br />
              <span className="text-white/60">{t.auth.growth}</span>
            </h2>
            <p className="text-white/45 text-[15px] leading-relaxed max-w-[420px] mb-8">
              {t.auth.heroTagline}
            </p>

            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 mb-10">
              {['Reclutamiento', 'Evaluaciones', 'Onboarding', 'Performance', 'Nine Box', 'Analytics'].map((f) => (
                <span
                  key={f}
                  className="text-[11px] text-white/50 border border-white/15 rounded-full px-3.5 py-1.5 backdrop-blur-sm"
                >
                  {f}
                </span>
              ))}
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-3">
              <div className="flex -space-x-2">
                {['bg-emerald-500', 'bg-blue-500', 'bg-amber-500', 'bg-purple-500'].map((c, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full ${c} ring-2 ring-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold`}>
                    {['ML', 'CA', 'JR', 'FT'][i]}
                  </div>
                ))}
              </div>
              <p className="text-white/35 text-[13px]">
                +1,200 profesionales confian en TIMS
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center bg-[#F6F6F6] px-6">
        <div className="flex-1 flex items-center justify-center w-full">
          {children}
        </div>
        {/* Footer */}
        <div className="flex items-center justify-center gap-1.5 pb-6">
          <span className="text-[11px] text-[#8B8B8B]">{t.auth.poweredBy}</span>
          <img src="/nexadev-logo.png" alt="NexaDev" className="h-[18px]" />
          <span className="text-[12px] font-medium text-[#585858]">NexaDev</span>
          <span className="text-[7px] text-[#8B8B8B] align-super -ml-0.5">TM</span>
        </div>
      </div>
    </div>
  );
}
