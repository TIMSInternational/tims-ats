'use client';

import type { ReactNode } from 'react';
import type { ConsentBlock, ConsentTemplate } from '../../../../../lib/platform-api/assessment-provider-portal';
import { CHOICE_INPUT_CLASSES } from '../../../../../components';

// One consent text from the provider, in full, with its own acceptance checkbox. The API's blocks are plain text by
// contract (no markup): every one is rendered as React text nodes, never as HTML.
export function ProviderConsentTemplateCard({
  template,
  checked,
  label,
  onChange,
}: {
  template: ConsentTemplate;
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  const id = `consent-${template.purpose}`;
  const titleId = `${id}-title`;
  // The text flows in the page (no clipped scroll box); the checkbox sits under it, described by the text's title, so
  // two "Acepto (opcional)." boxes are told apart by what they accept (toggles.md › Best practices).
  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-border p-4" lang={template.locale}>
      <h3 id={titleId} className="mb-2 text-subheading font-semibold text-brand">
        {template.title}
      </h3>
      <div className="max-w-prose space-y-2 text-body leading-relaxed text-primary">
        {template.blocks.map((block, index) => renderBlock(block, index))}
      </div>
      <label
        htmlFor={id}
        className="mt-3 flex min-h-7 cursor-pointer items-start gap-2 border-t border-border pt-3 text-body font-medium text-primary pointer-coarse:min-h-11"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={titleId}
          onChange={(event) => onChange(event.target.checked)}
          className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
        />
        <span>{label}</span>
      </label>
    </section>
  );
}

function renderBlock(block: ConsentBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return (
        <h4 key={index} className="text-subheading font-semibold text-primary">
          {block.text}
        </h4>
      );
    case 'list': {
      const items = (block.items ?? []).map((item, i) => <li key={i}>{item}</li>);
      return block.ordered ? (
        <ol key={index} className="list-decimal pl-5 space-y-1">
          {items}
        </ol>
      ) : (
        <ul key={index} className="list-disc pl-5 space-y-1">
          {items}
        </ul>
      );
    }
    case 'callout':
      return (
        <p
          key={index}
          role="note"
          className={
            block.tone === 'warning' ? 'rounded-lg bg-warning-bg p-3 text-warning' : 'rounded-lg bg-brand-tint p-3'
          }
        >
          {block.text}
        </p>
      );
    default:
      return <p key={index}>{block.text}</p>;
  }
}
