interface ApplyStepIndicatorProps {
  step: 1 | 2 | 3;
  labels: readonly [string, string, string];
}

// "1 Datos personales — 2 Perfil y motivación — 3 Revisar y enviar" header of the apply modal.
export function ApplyStepIndicator({ step, labels }: ApplyStepIndicatorProps) {
  return (
    <div className="mb-6 flex items-center gap-2">
      {labels.map((label, i) => (
        <div key={i} className="flex flex-1 items-center gap-2">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
              step > i + 1
                ? 'bg-green-500 text-white'
                : step === i + 1
                  ? 'bg-[#DD0C15] text-white'
                  : 'bg-[#EDEDED] text-muted'
            }`}
          >
            {step > i + 1 ? '✓' : i + 1}
          </div>
          {/* On a phone only the current step is named, so the three labels never squeeze the row. */}
          <span className={`text-[11px] ${step === i + 1 ? 'font-medium text-[#1F114C]' : 'hidden text-muted sm:inline'}`}>
            {label}
          </span>
          {i < 2 && <div className={`h-[1px] flex-1 ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
        </div>
      ))}
    </div>
  );
}
