'use client';

import { usePathname } from 'next/navigation';

const BREADCRUMB_MAP: Record<string, { parent?: string; label: string }> = {
  '/dashboard': { label: 'Command Center' },
  '/recruitment/pipeline': { parent: 'Reclutamiento', label: 'Pipeline' },
  '/recruitment/vacancies': { parent: 'Reclutamiento', label: 'Vacantes' },
  '/recruitment/candidates': { parent: 'Reclutamiento', label: 'Candidatos' },
  '/recruitment/interviews': { parent: 'Reclutamiento', label: 'Entrevistas' },
  '/recruitment/offers': { parent: 'Reclutamiento', label: 'Ofertas' },
  '/recruitment/talent-pools': { parent: 'Reclutamiento', label: 'Talent Pool' },
  '/recruitment/analytics': { parent: 'Reclutamiento', label: 'Analytics' },
  '/people/onboarding': { parent: 'Personas', label: 'Onboarding' },
  '/people/performance': { parent: 'Personas', label: 'Performance & OKR' },
  '/learning': { parent: 'Personas', label: 'Capacitacion & Desarrollo' },
  '/talent/nine-box': { parent: 'Talento', label: 'Nine Box Predictivo' },
  '/talent/succession': { parent: 'Talento', label: 'Mapa de Sucesion' },
  '/talent/team-intelligence': { parent: 'Talento', label: 'Inteligencia de Equipo' },
  '/engagement/climate': { parent: 'Organizacion', label: 'Engagement & Clima' },
  '/engagement/dei': { parent: 'Organizacion', label: 'DEI Analytics' },
  '/compensation': { parent: 'Organizacion', label: 'Compensacion & Beneficios' },
  '/monitoring': { parent: 'Estrategia', label: 'Monitoreo Estrategico' },
  '/settings/integrations': { parent: 'Configuracion', label: 'HRIS & Integraciones' },
};

export function Navbar() {
  const pathname = usePathname();
  const crumb = BREADCRUMB_MAP[pathname] || { label: 'TIMS Platform' };

  return (
    <header className="flex items-center justify-between px-6 h-[56px] bg-white border-b border-[#EDEDED] shrink-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5">
        {crumb.parent && (
          <>
            <span className="text-[13px] text-[#8B8B8B]">{crumb.parent}</span>
            <svg className="w-3.5 h-3.5 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </>
        )}
        <span className="text-[13px] font-medium text-[#1F114C]">{crumb.label}</span>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <div className="relative">
          <svg className="w-4 h-4 text-[#8B8B8B] absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Buscar..."
            className="h-8 pl-9 pr-3 rounded-lg border border-[#EDEDED] bg-[#FAFAFA] text-[12px] text-[#333] placeholder:text-[#8B8B8B] w-[200px] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/20 focus:border-[#1F114C]/30 transition"
          />
        </div>

        {/* Notifications */}
        <button className="relative w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#F6F6F6] transition-colors">
          <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
          <span className="absolute top-1 right-1 w-[18px] h-[18px] rounded-full bg-[#DD0C15] text-white text-[9px] font-bold flex items-center justify-center">
            7
          </span>
        </button>

        {/* Help */}
        <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#F6F6F6] transition-colors">
          <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>

        {/* Language */}
        <button className="h-8 px-2.5 rounded-lg border border-[#EDEDED] flex items-center gap-1.5 hover:bg-[#FAFAFA] transition-colors">
          <span className="text-[12px] text-[#585858] font-medium">ES</span>
          <svg className="w-3 h-3 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
