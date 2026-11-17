'use client';

import type { ReactNode } from 'react';
import { Info, TriangleAlert } from 'lucide-react';
import type { ConsentBlock, ConsentTemplate } from '../../../../../lib/platform-api/assessment-provider-portal';
import {
  CONSENT_TEXT_CLASSES,
  CONSENT_TEXT_HEADING_CLASSES,
  CONSENT_TEXT_LIST_CLASSES,
  CONSENT_TEXT_NOTE_CLASSES,
  CONSENT_TEXT_PARAGRAPH_CLASSES,
} from './provider-consent-styles';

// One consent text from the provider, complete and as served: every block, in order, nothing shortened. The API's blocks
// are plain text by contract (no markup), so every one is rendered as React text nodes, never as HTML. It is shown in
// the full-text sheet, whose heading is the template's title; the text's own headings sit one level under it. In the
// TIMS evaluation design: the sheet's 15px / 1.55 ink reading text, 15px semibold headings, and notes in the PCA Callout
// shape (a toned icon; the words stay ink and at reading size).
export function ProviderConsentText({ template }: { template: ConsentTemplate }) {
  return (
    <div lang={template.locale} className={CONSENT_TEXT_CLASSES}>
      {template.blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function renderBlock(block: ConsentBlock, index: number): ReactNode {
  switch (block.type) {
    case 'heading':
      return (
        <h3 key={index} className={CONSENT_TEXT_HEADING_CLASSES}>
          {block.text}
        </h3>
      );
    case 'list': {
      const items = (block.items ?? []).map((item, i) => <li key={i}>{item}</li>);
      return block.ordered ? (
        <ol key={index} className={CONSENT_TEXT_LIST_CLASSES.ordered}>
          {items}
        </ol>
      ) : (
        <ul key={index} className={CONSENT_TEXT_LIST_CLASSES.unordered}>
          {items}
        </ul>
      );
    }
    case 'callout': {
      const warning = block.tone === 'warning';
      return (
        <p key={index} role="note" className={CONSENT_TEXT_NOTE_CLASSES[warning ? 'warning' : 'info']}>
          {warning ? <TriangleAlert aria-hidden="true" /> : <Info aria-hidden="true" />}
          {block.text}
        </p>
      );
    }
    default:
      return (
        <p key={index} className={CONSENT_TEXT_PARAGRAPH_CLASSES}>
          {block.text}
        </p>
      );
  }
}
