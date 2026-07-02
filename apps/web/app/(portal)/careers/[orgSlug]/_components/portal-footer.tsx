import Image from 'next/image';
import { useI18n } from '../../../../../lib/i18n';

interface PortalFooterProps {
  orgName: string;
}

const columns = [
  {
    title: 'Plataforma',
    links: ['Vacantes', 'Empresas', 'Evaluaciones', 'Blog'],
  },
  {
    title: 'Empresa',
    links: ['Sobre Nosotros', 'Contacto', 'Carreras', 'Socios'],
  },
  {
    title: 'Legal',
    links: ['Privacidad', 'Terminos', 'Cookies', 'Licencias'],
  },
];

export function PortalFooter({ orgName }: PortalFooterProps) {
  const { t } = useI18n();
  return (
    <footer className="bg-[#1F114C] px-8 py-8">
      <div className="mx-auto max-w-5xl">
        {/* Top row */}
        <div className="flex flex-col justify-between gap-8 md:flex-row">
          {/* Left: logo + description */}
          <div className="max-w-xs">
            <Image
              src="/logo_tims.png"
              alt="TIMS"
              width={120}
              height={32}
              className="h-8 w-auto brightness-0 invert"
            />
            <p className="mt-3 text-[12px] leading-relaxed text-white/50">
              {orgName} {t.portal.footerUsesTimsSuffix}
            </p>
          </div>

          {/* Right: link columns */}
          <div className="flex gap-12">
            {columns.map((col) => (
              <div key={col.title}>
                <h4 className="text-[11px] font-bold uppercase tracking-[1px] text-white/40">
                  {col.title}
                </h4>
                <ul className="mt-3 space-y-2">
                  {col.links.map((link) => (
                    <li key={link}>
                      <span className="cursor-pointer text-[12px] text-white/60 transition-colors hover:text-white">
                        {link}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom */}
        <div className="mt-8 flex flex-col items-center justify-between gap-2 border-t border-white/10 pt-6 sm:flex-row">
          <p className="text-[11px] text-white/40">
            &copy; {new Date().getFullYear()} {orgName}. {t.portal.allRightsReserved}
          </p>
          <p className="text-[11px] text-white/40">
            {t.auth.poweredBy} <span className="font-semibold text-white/60">TIMS ATS</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
