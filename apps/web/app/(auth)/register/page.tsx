'use client';

import { useState } from 'react';
import Link from 'next/link';
import { RegisterForm } from './register-form';

type AccountType = null | 'candidate' | 'company';

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
          <h2 className="text-lg font-semibold text-[#1F114C] mb-1">Crear Cuenta</h2>
          <p className="text-[13px] text-[#8B8B8B] mb-8">Selecciona el tipo de cuenta que deseas crear</p>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setAccountType('candidate')}
              className="group flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-[#EDEDED] hover:border-[#1F114C] hover:bg-[#1F114C]/[0.02] transition-all text-center"
            >
              <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                <svg className="w-7 h-7 text-blue-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#1F114C]">Soy Candidato</p>
                <p className="text-[11px] text-[#8B8B8B] mt-1">Busco oportunidades laborales y quiero aplicar a vacantes</p>
              </div>
            </button>

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
