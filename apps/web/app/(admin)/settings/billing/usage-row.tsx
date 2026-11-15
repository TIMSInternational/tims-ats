'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { formatNumber } from '../../../../lib/format-utils';
import { ProgressBar, StatusBadge } from '../../../../components';

/** One "Uso" line: used vs limit, an over-limit chip and a meter (settings-23). */
interface UsageRowProps {
  label: string;
  used: number;
  limit: number | null;
}

export function UsageRow({ label, used, limit }: UsageRowProps) {
  const { t, locale } = useI18n();
  const over = limit != null && used > limit;
  const usedText = formatNumber(used, locale);
  const valueText =
    limit != null
      ? formatMessage(t.billing.usageOf, { used: usedText, limit: formatNumber(limit, locale) })
      : formatMessage(t.billing.usageUnlimited, { used: usedText });
  return (
    <div className="border-b border-border-subtle py-2.5 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body text-secondary">{label}</span>
        <span className="flex items-center gap-2">
          {over && <StatusBadge tone="danger">{t.billing.overLimit}</StatusBadge>}
          <span className="text-body font-medium tabular-nums text-primary">{valueText}</span>
        </span>
      </div>
      {limit != null && limit > 0 && (
        <ProgressBar
          className="mt-1.5"
          value={Math.min(used, limit)}
          max={limit}
          label={label}
          hideLabel
          valueText={valueText}
          kind="meter"
          tone={over ? 'danger' : 'brand'}
        />
      )}
    </div>
  );
}
