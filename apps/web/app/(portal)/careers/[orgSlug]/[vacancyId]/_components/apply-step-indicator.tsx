import { useI18n } from '../../../../../../lib/i18n';
import { formatMessage } from '../../../../../../lib/i18n/format';

interface ApplyStepIndicatorProps {
  step: 1 | 2 | 3;
  labels: readonly [string, string, string];
}

// "1 Datos personales — 2 Perfil y motivación — 3 Revisar y enviar" header of the apply modal. State is
// carried by shape and text as well as colour: a check plus "(completado)" for done steps,
// aria-current="step" on the current one, and "Paso n de 3 · …" on phones (accessibility.md › Vision).
export function ApplyStepIndicator({ step, labels }: ApplyStepIndicatorProps) {
  const { t } = useI18n();
  return (
    <div className="mb-6">
      <ol aria-label={t.common.steps} className="flex items-center gap-2">
        {labels.map((label, i) => {
          const n = i + 1;
          const done = step > n;
          const current = step === n;
          return (
            <li key={label} aria-current={current ? 'step' : undefined} className="flex flex-1 items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-caption font-bold ${
                  done ? 'bg-success-bg text-success' : current ? 'bg-brand text-white' : 'bg-surface text-secondary'
                }`}
              >
                {done ? (
                  <svg className="size-3" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" focusable="false">
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  n
                )}
              </span>
              {/* On a phone only the current step is named, so the three labels never squeeze the row. */}
              <span className={`text-callout ${current ? 'font-medium text-brand max-sm:sr-only' : 'sr-only text-secondary sm:not-sr-only'}`}>
                {label}
                {done && <span className="sr-only"> ({t.common.stepDone})</span>}
              </span>
              {i < 2 && <span aria-hidden="true" className={`h-px flex-1 ${done ? 'bg-success' : 'bg-border'}`} />}
            </li>
          );
        })}
      </ol>
      <p aria-hidden="true" className="mt-2 text-callout text-secondary sm:hidden">
        {formatMessage(t.common.stepOf, { current: step, total: labels.length })} · {labels[step - 1]}
      </p>
    </div>
  );
}
