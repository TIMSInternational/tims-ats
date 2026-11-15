'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { BUTTON_GROUP_CLASSES, Button, Stepper } from '../../../../../components';
import { ConsentStep } from '../../../../../components/consent-step';
import { ProviderConsentReview } from './provider-consent-review';
import { ProviderConsentSheet } from './provider-consent-sheet';

/** One thing to read and tick: the ATS notice, a required provider consent, or an optional one. */
export interface ConsentGuideItem {
  /** Unique within the guide (a consent purpose, or the notice's own key). */
  key: string;
  /** The short label in the "Paso n de N" indicator. */
  stepLabel: string;
  /** The text's own approved title. */
  title: string;
  /** One neutral line: navigation or instructions only. */
  line: string;
  checkboxLabel: string;
  /** The word the final step shows for a ticked box ("Leído", "Aceptado"). */
  checkedLabel: string;
  /** Optional steps say so and never block. */
  optional: boolean;
  /** The text's language when it is not the page's. */
  lang?: string;
  /** The complete approved text, shown verbatim in the full-text sheet. */
  fullText: ReactNode;
}

// The step-by-step consent guide of the candidate portal (round 3 owner direction): one screen per step, a "Paso n de N"
// indicator, Back / Continue. Each step is the text's title, one neutral line, "Leer el texto completo" (a full-screen
// sheet with the complete text) and an UNCHECKED checkbox. A required step's Continue waits for its box; an optional
// step never blocks. With `review`, a last step lists what was read and accepted before the finish button; the finish
// button also re-checks every required box, so the required gating is the same as before the guide. Cancel leads on the
// first step and Back on the others, never both (sheets.md › Best practices: "Avoid showing all three buttons").
export function ProviderConsentGuide({
  items,
  review = false,
  finishLabel,
  busy,
  onFinish,
  onCancel,
}: {
  items: ConsentGuideItem[];
  /** Add the final "Empezar" step that lists every choice. */
  review?: boolean;
  finishLabel: string;
  busy: boolean;
  /** What was ticked, by item key. Called only when every required item is ticked. */
  onFinish: (checked: Record<string, boolean>) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const m = t.portalDashboard;
  const hintId = useId();
  const [index, setIndex] = useState(0);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reading, setReading] = useState<ConsentGuideItem | null>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const total = items.length + (review ? 1 : 0);
  const item = index < items.length ? items[index] : undefined;
  const isLast = index === total - 1;
  const allRequired = items.every((entry) => entry.optional || checked[entry.key] === true);
  const waiting = item !== undefined && !item.optional && checked[item.key] !== true;
  const steps = [...items.map((entry) => entry.stepLabel), ...(review ? [m.providerGuideStepStart] : [])];

  // After Back or Continue, the new step is announced and the keyboard starts on it (the button pressed may be gone).
  useEffect(() => {
    if (moved.current) stepRef.current?.focus();
  }, [index]);
  const go = (next: number) => {
    moved.current = true;
    setIndex(next);
  };

  return (
    <div className="mt-4 space-y-4 border-t border-border pt-4" role="group" aria-label={m.providerConsentTitle}>
      {total > 1 && <Stepper steps={steps} current={index} />}
      <div ref={stepRef} tabIndex={-1} className="rounded-lg">
        {item ? (
          <ConsentStep
            key={item.key}
            title={item.title}
            line={item.line}
            lang={item.lang}
            optionalLabel={item.optional ? m.providerGuideOptional : undefined}
            checkboxLabel={item.checkboxLabel}
            checked={checked[item.key] === true}
            onChange={(value) => setChecked((current) => ({ ...current, [item.key]: value }))}
            readFullLabel={m.providerGuideReadFull}
            onReadFull={() => setReading(item)}
            describedBy={waiting ? hintId : undefined}
          />
        ) : (
          <ProviderConsentReview items={items} checked={checked} />
        )}
      </div>
      {waiting && (
        <p id={hintId} className="text-callout text-secondary sm:text-right">
          {m.providerGuideCheckToContinue}
        </p>
      )}
      <div className={BUTTON_GROUP_CLASSES}>
        {index === 0 ? (
          <Button variant="secondary" size="lg" onClick={onCancel} disabled={busy}>
            {m.providerCancel}
          </Button>
        ) : (
          <Button variant="secondary" size="lg" onClick={() => go(index - 1)} disabled={busy}>
            {t.common.back}
          </Button>
        )}
        {isLast ? (
          <Button
            size="lg"
            disabled={!allRequired}
            loading={busy}
            loadingLabel={m.providerOpening}
            aria-describedby={waiting ? hintId : undefined}
            onClick={() => onFinish(checked)}
          >
            {finishLabel}
          </Button>
        ) : (
          <Button
            size="lg"
            disabled={waiting}
            aria-describedby={waiting ? hintId : undefined}
            onClick={() => go(index + 1)}
          >
            {m.providerGuideContinue}
          </Button>
        )}
      </div>
      {reading && (
        <ProviderConsentSheet title={reading.title} lang={reading.lang} onClose={() => setReading(null)}>
          {reading.fullText}
        </ProviderConsentSheet>
      )}
    </div>
  );
}
