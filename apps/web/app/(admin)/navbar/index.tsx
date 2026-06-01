'use client';

import { useState, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useI18n } from '../../../lib/i18n';
import { SearchCommand } from './search-command';
import { NotificationDropdown } from './notification-dropdown';

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

export function Navbar({ isPlatformOwner = false, onHelpClick }: { isPlatformOwner?: boolean; onHelpClick?: () => void }) {
  const pathname = usePathname();
  const { locale, setLocale, t } = useI18n();

  const breadcrumbs = t.breadcrumbs as Record<string, { parent?: string; label: string }>;
  const crumb = breadcrumbs[pathname] || { label: 'TIMS Platform' };

  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);
  useClickOutside(langRef, () => setLangOpen(false));

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
      <div className="flex items-center gap-1.5">
        <SearchCommand onFocus={() => setLangOpen(false)} />

        <NotificationDropdown onOpen={() => setLangOpen(false)} />

        {/* Help */}
        <button
          onClick={onHelpClick}
          className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[#F6F6F6] transition-colors"
          title={t.nav.helpCenter}
        >
          <svg className="w-[18px] h-[18px] text-[#585858]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>

        {/* Language */}
        <div ref={langRef} className="relative">
          <button
            onClick={() => setLangOpen(!langOpen)}
            className={`h-8 px-2.5 rounded-lg border border-[#EDEDED] flex items-center gap-1.5 transition-colors ${
              langOpen ? 'bg-[#FAFAFA] border-[#ccc]' : 'hover:bg-[#FAFAFA]'
            }`}
          >
            <span className="text-[12px] text-[#585858] font-medium">{locale}</span>
            <svg className={`w-3 h-3 text-[#8B8B8B] transition-transform ${langOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {langOpen && (
            <div className="absolute right-0 top-full mt-2 w-[140px] bg-white rounded-xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-[#EDEDED] z-50 overflow-hidden py-1">
              {[
                { code: 'ES' as const, label: 'Espanol', flag: '🇪🇸' },
                { code: 'EN' as const, label: 'English', flag: '🇺🇸' },
              ].map((l) => (
                <button
                  key={l.code}
                  onClick={() => { setLocale(l.code); setLangOpen(false); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[#FAFAFA] transition-colors ${
                    locale === l.code ? 'bg-[#F6F6F6]' : ''
                  }`}
                >
                  <span className="text-[14px]">{l.flag}</span>
                  <span className="text-[12px] text-[#333]">{l.label}</span>
                  {locale === l.code && (
                    <svg className="w-3.5 h-3.5 text-[#1F114C] ml-auto" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
