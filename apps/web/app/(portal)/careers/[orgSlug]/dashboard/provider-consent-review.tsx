'use client';

import { useId } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { StatusBadge } from '../../../../../components';
import type { ConsentGuideItem } from './provider-consent-guide';

// The last step of the consent guide ("Empezar"): each text by its own title with what the candidate chose, so the
// choice can be checked, and changed with Back, before anything is recorded. The state is a word with an icon, never a
// colour alone (accessibility.md › Vision: "Convey information with more than color alone"). The optional consents sit
// under their own heading with the portal's existing explanation of what leaving them unticked means.
export function ProviderConsentReview({
  items,
  checked,
}: {
  items: ConsentGuideItem[];
  checked: Record<string, boolean>;
}) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  const titleId = useId();
  const optionalId = useId();
  const required = items.filter((item) => !item.optional);
  const optional = items.filter((item) => item.optional);
  const row = (item: ConsentGuideItem) => {
    const isChecked = checked[item.key] === true;
    return (
      <li key={item.key} className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-3">
        <span lang={item.lang} className="min-w-0 text-base text-primary sm:text-body">
          {item.title}
        </span>
        <StatusBadge tone={isChecked ? 'success' : 'neutral'} icon={isChecked ? 'auto' : 'none'}>
          {isChecked ? item.checkedLabel : m.providerGuideNotAccepted}
        </StatusBadge>
      </li>
    );
  };
  return (
    <section aria-labelledby={titleId} className="space-y-3" data-testid="consent-review">
      <h3 id={titleId} className="text-subheading font-semibold text-primary">
        {m.providerGuideReviewTitle}
      </h3>
      <p className="max-w-prose text-base text-secondary sm:text-body">{m.providerGuideReviewLine}</p>
      <ul className="divide-y divide-border rounded-xl border border-border">{required.map(row)}</ul>
      {optional.length > 0 && (
        <section aria-labelledby={optionalId} className="space-y-2">
          <h4 id={optionalId} className="text-subheading font-semibold text-primary">
            {m.providerOptionalTitle}
          </h4>
          <ul className="divide-y divide-border rounded-xl border border-border">{optional.map(row)}</ul>
          <p className="max-w-prose text-callout text-secondary">{m.providerOptionalIntro}</p>
        </section>
      )}
    </section>
  );
}
