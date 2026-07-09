'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import type { EntitlementItem } from '../../../../../../lib/trpc-types';

const SOURCE_STYLES: Record<string, string> = {
  plan: 'bg-blue-100 text-blue-700',
  addon: 'bg-violet-100 text-violet-700',
  override: 'bg-amber-100 text-amber-700',
};

const KIND_STYLES: Record<string, string> = {
  core: 'bg-emerald-100 text-emerald-700',
  addon: 'bg-violet-100 text-violet-700',
};

function parseNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

interface EntitlementRowProps {
  entitlement: EntitlementItem;
  disabled: boolean;
  onToggle: (moduleCode: string, enabled: boolean) => void;
  onLimitCommit: (moduleCode: string, value: number | null) => void;
  onUnitPriceCommit: (moduleCode: string, value: number | null) => void;
}

// Extracted from entitlements-section.tsx to keep the parent under the
// 300-line component limit. Local draft state for the limit/unit-price
// inputs is keyed (via the parent's `key`) to `moduleCode:limit:source` so a
// server-driven change (e.g. Apply Plan re-asserting the baseline) remounts
// the row with fresh values instead of stale local drafts.
export function EntitlementRow({ entitlement, disabled, onToggle, onLimitCommit, onUnitPriceCommit }: EntitlementRowProps) {
  const { t } = useI18n();
  const [limitDraft, setLimitDraft] = useState(entitlement.limit == null ? '' : String(entitlement.limit));
  // Seeded from the RAW per-org override (entitlement.unitPrice), never from
  // effectiveUnitPrice (the merged override-or-catalog-default value). An
  // input whose draft started from the merged value would look "empty/blank
  // for no override" but blur-commit the catalog default as an explicit new
  // override — silently wiping any real per-org override on the next read.
  const [priceDraft, setPriceDraft] = useState(entitlement.unitPrice == null ? '' : String(entitlement.unitPrice));

  // Dirty-check guards: an untouched blur (tab-through, click-to-inspect,
  // misclick) must never fire a commit mutation. Only commit when the parsed
  // draft actually differs from the last known committed value — this also
  // fixes the "every blur fires a mutation + toast even with no change" noise
  // on both fields, not just unitPrice.
  const handleLimitBlur = () => {
    const parsed = parseNumberOrNull(limitDraft);
    if (parsed === entitlement.limit) return;
    onLimitCommit(entitlement.moduleCode, parsed);
  };

  const handleUnitPriceBlur = () => {
    const parsed = parseNumberOrNull(priceDraft);
    if (parsed === entitlement.unitPrice) return;
    onUnitPriceCommit(entitlement.moduleCode, parsed);
  };

  const source = entitlement.source;
  const sourceLabel = source === 'plan'
    ? t.entitlementsAdmin.sourcePlan
    : source === 'addon'
      ? t.entitlementsAdmin.sourceAddon
      : source === 'override'
        ? t.entitlementsAdmin.sourceOverride
        : null;
  const sourceStyle = source != null ? SOURCE_STYLES[source] || 'bg-gray-100 text-gray-700' : '';

  return (
    <tr className="hover:bg-[#FAFAFA]">
      <td className="px-5 py-2.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-[#333]">{entitlement.name}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${KIND_STYLES[entitlement.kind] || 'bg-gray-100 text-gray-700'}`}>
            {entitlement.kind}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => onToggle(entitlement.moduleCode, !entitlement.enabled)}
          disabled={disabled}
          className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50 ${
            entitlement.enabled ? 'bg-[#1F114C]' : 'bg-gray-300'
          }`}
        >
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
            entitlement.enabled ? 'left-[22px]' : 'left-0.5'
          }`} />
        </button>
      </td>
      <td className="px-4 py-2.5">
        {entitlement.metered ? (
          <input
            type="number"
            min={0}
            value={limitDraft}
            onChange={(e) => setLimitDraft(e.target.value)}
            onBlur={handleLimitBlur}
            disabled={disabled}
            className="w-24 h-8 px-2 rounded-lg border border-[#EDEDED] text-xs text-[#333] disabled:opacity-50"
          />
        ) : (
          <span className="text-xs text-[#8B8B8B]">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {entitlement.metered ? (
          <input
            type="number"
            min={0}
            step="0.01"
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            onBlur={handleUnitPriceBlur}
            placeholder={entitlement.effectiveUnitPrice != null ? String(entitlement.effectiveUnitPrice) : t.entitlementsAdmin.catalogDefault}
            disabled={disabled}
            className="w-28 h-8 px-2 rounded-lg border border-[#EDEDED] text-xs text-[#333] disabled:opacity-50"
          />
        ) : (
          <span className="text-xs text-[#8B8B8B]">{'\u2014'}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        {sourceLabel ? (
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${sourceStyle}`}>
            {sourceLabel}
          </span>
        ) : (
          <span className="text-xs text-[#8B8B8B]">{'\u2014'}</span>
        )}
      </td>
    </tr>
  );
}
