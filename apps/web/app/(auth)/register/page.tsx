'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RegisterForm } from './register-form';

// Candidate self-registration was removed: candidates are not staff and never get a
// `User` row — they apply through an employer's careers link, which creates a
// Candidate record and signs them in via a portal magic-link (see the candidate
// portal). /register is for COMPANIES (org admins) only.
type AccountType = null | 'company';

export default function RegisterPage() {
  const [accountType, setAccountType] = useState<AccountType>(null);

  if (!accountType) {
    return (
      <div className="w-full max-w-[480px]">
        <div className="text-center mb-8 lg:hidden">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
            <span className="text-white text-xl font-bold">T</span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
          <h2 className="text-lg font-semibold text-[#1F114C] mb-1">Crear Cuenta de Empresa</h2>
          <p className="text-[13px] text-[#8B8B8B] mb-8">Registra tu organizacion para gestionar tu talento humano</p>

          <div className="grid grid-cols-1 gap-4">
            <button
              onClick={() => setAccountType('company')}
              className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[#EDEDED] hover:border-[#1F114C] hover:bg-[#1F114C]/[0.02] transition-all text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
                </svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#1F114C]">Soy Empresa</p>
                <p className="text-[11px] text-[#8B8B8B] mt-1">Quiero gestionar el talento humano de mi organizacion</p>
              </div>
            </button>
          </div>

          <p className="text-center text-[12px] text-[#8B8B8B] mt-6">
            Eres candidato? Postula directamente desde el enlace de empleos de la empresa.
          </p>
          <p className="text-center text-[12px] text-[#8B8B8B] mt-2">
            Ya tienes cuenta?{' '}
            <Link href="/login" className="text-[#DD0C15] font-medium hover:underline">
              Iniciar Sesion
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="text-center mb-8 lg:hidden">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#1F114C] mb-4">
          <span className="text-white text-xl font-bold">T</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.08)] p-8">
        <RegisterForm accountType={accountType} onBack={() => setAccountType(null)} />
      </div>
    </div>
  );
}
