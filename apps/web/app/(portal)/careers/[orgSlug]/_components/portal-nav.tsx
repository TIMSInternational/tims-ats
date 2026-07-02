'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';

interface PortalNavProps {
  orgName: string;
  orgSlug: string;
}

const navLinks = [
  { label: 'Inicio', href: '#', active: true },
  { label: 'Vacantes', href: '#vacantes', active: false },
  { label: 'Nosotros', href: '#nosotros', active: false },
  { label: 'Beneficios', href: '#beneficios', active: false },
];

export function PortalNav({ orgName, orgSlug }: PortalNavProps) {
  const { t } = useI18n();
  const [activeLink, setActiveLink] = useState('Inicio');

  return (
    <nav className="sticky top-0 z-50 h-[72px] w-full border-b border-[#EDEDED] bg-white">
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between px-6">
        {/* Left: Logo + Nav Links */}
        <div className="flex items-center gap-8">
          <Link href={`/careers/${orgSlug}`}>
            <Image
              src="/logo_tims.png"
              alt={orgName}
              width={120}
              height={36}
              className="h-9 w-auto"
            />
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.label}
                href={link.href}
                onClick={() => setActiveLink(link.label)}
                className={`flex h-[72px] items-center text-[13px] transition-colors ${
                  activeLink === link.label
                    ? 'border-b-2 border-[#DD0C15] font-medium text-[#1F114C]'
                    : 'text-[#585858] hover:text-[#1F114C]'
                }`}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>

        {/* Right: Language Toggle + Buttons */}
        <div className="flex items-center gap-4">
          <span className="hidden text-[13px] text-[#585858] sm:block">
            ES <span className="text-[#EDEDED]">|</span> EN
          </span>

          <Link
            href="/auth/login"
            className="hidden rounded-lg border border-[#1F114C] px-4 py-2 text-[13px] font-medium text-[#1F114C] transition-colors hover:bg-[#1F114C] hover:text-white sm:block"
          >
            {t.portal.signInNav}
          </Link>

          <Link
            href="/auth/register"
            className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[13px] font-medium text-white shadow-md transition-colors hover:bg-[#c40a12]"
          >
            Registrarse
          </Link>
        </div>
      </div>
    </nav>
  );
}
