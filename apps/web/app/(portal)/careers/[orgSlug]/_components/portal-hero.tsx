'use client';

import Image from 'next/image';
import { Search, MapPin } from 'lucide-react';

interface PortalHeroProps {
  orgName: string;
  stats: { totalVacancies: number; totalLocations: number; totalDepartments: number } | undefined;
  search: string;
  location: string;
  onSearchChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onSearch: () => void;
}

export function PortalHero({
  orgName,
  stats,
  search,
  location,
  onSearchChange,
  onLocationChange,
  onSearch,
}: PortalHeroProps) {
  return (
    <section className="relative flex min-h-[420px] items-center justify-center overflow-hidden">
      {/* Background Image */}
      <Image
        src="/portal-hero.png"
        alt="Hero background"
        fill
        className="object-cover"
        priority
      />

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#1F114C]/90 via-[#2D1B6E]/80 to-[#1F114C]/85" />

      {/* Decorative Blurs */}
      <div className="absolute -left-20 -top-20 h-72 w-72 rounded-full bg-[#DD0C15] opacity-10 blur-3xl" />
      <div className="absolute -bottom-20 -right-20 h-72 w-72 rounded-full bg-[#2D1B6E] opacity-10 blur-3xl" />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center px-6 py-16 text-center">
        <span className="mb-3 text-[14px] tracking-[3px] text-white/60 uppercase">
          {orgName}
        </span>

        <h1 className="mb-4 text-[42px] font-extrabold leading-tight text-white">
          Construye tu futuro con nosotros
        </h1>

        <p className="mb-10 max-w-[550px] text-[16px] leading-relaxed text-white/70">
          Encuentra las mejores oportunidades laborales y da el siguiente paso en tu carrera profesional.
        </p>

        {/* Search Bar */}
        <div className="flex w-full max-w-[640px] items-center overflow-hidden rounded-xl bg-white shadow-lg">
          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-[#8B8B8B]" />
            <input
              type="text"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cargo, palabra clave..."
              className="w-full bg-transparent text-[14px] text-[#333333] placeholder:text-[#8B8B8B] outline-none"
            />
          </div>

          <div className="h-8 w-px bg-[#EDEDED]" />

          <div className="flex flex-1 items-center gap-2 px-4 py-3">
            <MapPin className="h-4 w-4 shrink-0 text-[#8B8B8B]" />
            <input
              type="text"
              value={location}
              onChange={(e) => onLocationChange(e.target.value)}
              placeholder="Ciudad o departamento..."
              className="w-full bg-transparent text-[14px] text-[#333333] placeholder:text-[#8B8B8B] outline-none"
            />
          </div>

          <button
            onClick={onSearch}
            className="m-1.5 shrink-0 rounded-lg bg-[#DD0C15] px-6 py-2.5 text-[14px] font-semibold text-white transition-colors hover:bg-[#c40a12]"
          >
            Buscar
          </button>
        </div>

        {/* Quick Stats */}
        {stats && (
          <div className="mt-8 flex flex-wrap items-center justify-center gap-6 text-[13px] text-white/60">
            <span className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              {stats.totalVacancies} vacantes abiertas
            </span>
            <span>{stats.totalLocations} ciudades</span>
            <span>{stats.totalDepartments} departamentos</span>
          </div>
        )}
      </div>
    </section>
  );
}
