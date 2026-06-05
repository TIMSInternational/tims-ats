'use client';

import { useI18n } from '../../../../lib/i18n';

// The change-audit feed lives in the platform Audit section, and getSystemHealth
// is a stub (no real telemetry). Render explicit unavailable states rather than
// fabricated audit rows / uptime numbers (rule #4).

export function AuditTrail() {
  const { t } = useI18n();
  return (
    <div className="w-full md:w-[60%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[155px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.integrations.auditTitle}</h3>
      <div className="flex items-center justify-center h-[90px] text-center">
        <p className="text-[12px] text-[#8B8B8B] max-w-sm">{t.integrations.auditUnavailable}</p>
      </div>
    </div>
  );
}

export function SystemHealth() {
  const { t } = useI18n();
  return (
    <div className="w-full md:w-[40%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-h-[155px]">
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">{t.integrations.systemHealth}</h3>
      <div className="flex items-center justify-center h-[90px] text-center">
        <p className="text-[12px] text-[#8B8B8B] max-w-xs">{t.integrations.systemHealthUnavailable}</p>
      </div>
    </div>
  );
}
