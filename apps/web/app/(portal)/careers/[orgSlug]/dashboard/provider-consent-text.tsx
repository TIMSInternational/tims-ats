'use client';

import type { ReactNode } from 'react';
import type { ConsentBlock, ConsentTemplate } from '../../../../../lib/platform-api/assessment-provider-portal';

// One consent text from the provider, complete and as served: every block, in order, nothing shortened. The API's blocks
// are plain text by contract (no markup), so every one is rendered as React text nodes, never as HTML. It is shown in
// the full-text sheet, whose heading is the template's title; the text's own headings sit one level under it.
export function ProviderConsentText({ template }: { template: ConsentTemplate }) {
  return (
    <div lang={template.locale} className="max-w-prose space-y-2 text-base leading-relaxed text-primary sm:text-body">
      {template.blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: ConsentBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return (
        <h3 key={index} className="text-subheading font-semibold text-primary">
          {block.text}
        </h3>
      );
    case 'list': {
      const items = (block.items ?? []).map((item, i) => <li key={i}>{item}</li>);
      return block.ordered ? (
        <ol key={index} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      ) : (
        <ul key={index} className="list-disc space-y-1 pl-5">
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
