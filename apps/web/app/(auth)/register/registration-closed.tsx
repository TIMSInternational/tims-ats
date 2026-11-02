'use client';

import Link from 'next/link';
import { useI18n } from '../../../lib/i18n';

// Shown at /register when company self-registration is off (SELF_SERVE_SIGNUP_ENABLED): staff accounts
// are created by invitation only.
export function RegistrationClosed() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-[420px]">
      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8 text-center">
        <h2 className="text-lg font-semibold text-[#1F114C] mb-2">{t.auth.registrationClosedTitle}</h2>
        <p className="text-[13px] text-[#585858] mb-6">{t.auth.registrationClosedDesc}</p>
        <Link
          href="/login"
          className="inline-flex h-10 items-center rounded-xl bg-[#1F114C] px-5 text-[13px] font-semibold text-white hover:bg-[#2a1a5e] transition"
        >
          {t.auth.login}
        </Link>
      </div>
    </div>
  );
}
