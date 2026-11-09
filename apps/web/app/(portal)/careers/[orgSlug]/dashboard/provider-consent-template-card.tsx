'use client';

import type { ReactNode } from 'react';
import type { ConsentBlock, ConsentTemplate } from '../../../../../lib/platform-api/assessment-provider-portal';

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
  return (
    <section className="rounded-xl border border-[#EDEDED] p-4" lang={template.locale}>
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-2">{template.title}</h3>
      <div className="max-h-64 overflow-y-auto space-y-2 text-[12px] text-[#585858]">
        {template.blocks.map((block, index) => renderBlock(block, index))}
      </div>
      <label htmlFor={id} className="mt-3 flex items-start gap-2 text-[12px] text-[#1F114C]">
        <input id={id} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    </section>
  );
}

function renderBlock(block: ConsentBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return (
        <h4 key={index} className="font-semibold text-[#1F114C]">
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
          className={block.tone === 'warning' ? 'rounded-lg bg-[#FFF4E5] p-2' : 'rounded-lg bg-[#F4F1FF] p-2'}
        >
          {block.text}
        </p>
      );
    default:
      return <p key={index}>{block.text}</p>;
  }
}
