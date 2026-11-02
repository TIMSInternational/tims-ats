'use client';

import { useI18n } from '../../lib/i18n';
import type { LegalLocale } from '../../lib/legal/documents';
import { SUBPROCESSORS, type SubprocessorCondition } from '../../lib/legal/subprocessors';

interface SubprocessorTableProps {
  locale: LegalLocale;
}

/** The code-derived subprocessor inventory (lib/legal/subprocessors.ts), rendered as plain text. */
export function SubprocessorTable({ locale }: SubprocessorTableProps) {
  const { t } = useI18n();
  const l = t.legal;
  const conditionLabel: Record<SubprocessorCondition, string> = {
    always: l.conditionAlways,
    configured: l.conditionConfigured,
    'customer-enabled': l.conditionCustomerEnabled,
  };

  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-[#EDEDED] bg-white">
      <table className="w-full min-w-[640px] text-left text-[12px] text-[#585858]">
        <thead className="bg-[#F6F6F6] text-[11px] uppercase tracking-[0.5px] text-[#8B8B8B]">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">
              {l.subprocessorVendor}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {l.subprocessorService}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {l.subprocessorPurpose}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {l.subprocessorData}
            </th>
            <th scope="col" className="px-3 py-2 font-semibold">
              {l.subprocessorCondition}
            </th>
          </tr>
        </thead>
        <tbody>
          {SUBPROCESSORS.map((sp) => (
            <tr key={sp.id} data-subprocessor-id={sp.id} className="border-t border-[#EDEDED] align-top">
              <td className="px-3 py-2 font-medium text-[#333]">{sp.vendor}</td>
              <td className="px-3 py-2">{sp.service}</td>
              <td className="px-3 py-2">{sp.purpose[locale]}</td>
              <td className="px-3 py-2">{sp.dataCategories[locale]}</td>
              <td className="px-3 py-2">{conditionLabel[sp.condition]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
