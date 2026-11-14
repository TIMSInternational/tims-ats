'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../lib/i18n/format';
import { formatCurrency } from '../../../../../../lib/format-utils';
import { StatusBadge, Switch, inputClasses } from '../../../../../../components';
import type { StatusTone } from '../../../../../../components';
import type { EntitlementItem } from '../../../../../../lib/trpc-types';

const SOURCE_TONE: Record<string, StatusTone> = { plan: 'info', addon: 'brand', override: 'warning' };

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
  const e = t.entitlementsAdmin;
  const nameId = `entitlement-${entitlement.moduleCode}-name`;
  const priceHelpId = `entitlement-${entitlement.moduleCode}-price-help`;
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
  const kindLabel = entitlement.kind === 'core' ? e.kindCore : entitlement.kind === 'addon' ? e.kindAddon : entitlement.kind;

  const dash = <span className="text-callout text-muted">{'\u2014'}</span>;
  return (
    <tr className="hover:bg-surface-hover">
      <td className="px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span id={nameId} className="text-body font-medium text-primary">{entitlement.name}</span>
          <StatusBadge tone={entitlement.kind === 'core' ? 'success' : 'neutral'} icon="none">{kindLabel}</StatusBadge>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Switch
          checked={entitlement.enabled}
          labelledBy={nameId}
          disabled={disabled}
          onChange={(next) => onToggle(entitlement.moduleCode, next)}
        />
      </td>
      <td className="px-4 py-2.5">
        {entitlement.metered ? (
          <input
            type="number"
            min={0}
            value={limitDraft}
            onChange={(ev) => setLimitDraft(ev.target.value)}
            onBlur={handleLimitBlur}
            disabled={disabled}
            aria-label={formatMessage(e.limitFor, { module: entitlement.name })}
            className={inputClasses('md', 'w-24 tabular-nums')}
          />
        ) : (
          dash
        )}
      </td>
      <td className="px-4 py-2.5">
        {entitlement.metered ? (
          <div>
            <div className="relative w-32">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-callout text-secondary" aria-hidden="true">USD</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={priceDraft}
                onChange={(ev) => setPriceDraft(ev.target.value)}
                onBlur={handleUnitPriceBlur}
                placeholder={e.defaultPlaceholder}
                disabled={disabled}
                aria-label={formatMessage(e.unitPriceFor, { module: entitlement.name })}
                aria-describedby={entitlement.effectiveUnitPrice != null ? priceHelpId : undefined}
                className={inputClasses('md', 'pl-11 tabular-nums')}
              />
            </div>
            {entitlement.effectiveUnitPrice != null && (
              <p id={priceHelpId} className="mt-1 text-caption text-secondary">
                {formatMessage(e.catalogPrice, { price: formatCurrency(entitlement.effectiveUnitPrice, 'USD', 2) })}
              </p>
            )}
          </div>
        ) : (
          dash
        )}
      </td>
      <td className="px-4 py-2.5">
        {sourceLabel && source ? (
          <StatusBadge tone={SOURCE_TONE[source] ?? 'neutral'} icon="none">{sourceLabel}</StatusBadge>
        ) : (
          dash
        )}
      </td>
    </tr>
  );
}
