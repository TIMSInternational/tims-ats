'use client';

import { QuickActions } from './quick-actions';
import { PlatformOwnerSection } from './platform-owner-section';
import { SystemInfo } from './system-info';

export default function SupportPage() {
  return (
    <main className="flex-1 overflow-y-auto p-6 space-y-5">
      {/* Section 1: Quick Actions */}
      <QuickActions />

      {/* Section 2: Platform Owner Email Management */}
      <PlatformOwnerSection />

      {/* Section 3: Data Requests (coming soon) */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          Solicitudes de Datos (GDPR / Habeas Data)
        </h3>
        <div className="py-8 text-center border border-dashed border-[#EDEDED] rounded-lg">
          <svg className="w-10 h-10 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
            <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <p className="text-sm text-gray-500 font-medium">Gestion de solicitudes de datos proximamente</p>
          <p className="text-xs text-gray-400 mt-1">
            Las solicitudes de exportacion y eliminacion de datos (Habeas Data / GDPR) se gestionaran aqui.
          </p>
        </div>
      </div>

      {/* Section 4: System Info + Recent Events */}
      <SystemInfo />
    </main>
  );
}
