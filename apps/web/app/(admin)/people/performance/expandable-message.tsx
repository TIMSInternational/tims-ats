'use client';

import { useId, useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button } from '../../../../components';

// Messages longer than this are clamped to three lines with a "Ver más" toggle.
const CLAMP_AFTER_CHARS = 160;

/** A feedback or recognition message: three lines, then "Ver más" / "Ver menos" (aria-expanded). */
export function ExpandableMessage({ text }: { text: string }) {
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const isLong = text.length > CLAMP_AFTER_CHARS;

  return (
    <div>
      <p id={id} className={`whitespace-pre-line text-body text-secondary ${isLong && !open ? 'line-clamp-3' : ''}`}>
        {text}
      </p>
      {isLong && (
        <Button
          variant="tertiary"
          size="sm"
          className="-ml-3"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t.performance.showLess : t.performance.showMore}
        </Button>
      )}
    </div>
  );
}
