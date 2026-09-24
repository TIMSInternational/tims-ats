'use client';

import { useI18n } from '../../../../../../../../lib/i18n';
import type { EvidenceState } from './proctoring-media-evidence';

interface ProctoringEvidenceStatusProps {
  consented: boolean;
  active: boolean;
  state: EvidenceState;
  onStop: () => void;
  onRetry: () => void;
}

export function ProctoringEvidenceStatus({ consented, active, state, onStop, onRetry }: ProctoringEvidenceStatusProps) {
  const copy = useI18n().t.proctoring.candidate;
  if (!consented) return null;
  return (
    <>
      {active && (
        <div className="flex flex-wrap items-center gap-2 text-[#493478]">
          <span>{copy.mediaEvidenceIndicator}</span>
          {state.uploading && <span role="status">{copy.mediaEvidenceUploading}</span>}
          <button type="button" onClick={onStop} className="rounded-lg border border-[#493478] px-3 py-1.5">
            {copy.mediaEvidenceStop}
          </button>
        </div>
      )}
      {state.active && (state.failed || state.unavailable) && (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-[#B42318]">
          <span>{state.unavailable ? copy.mediaEvidenceUnavailable : copy.mediaEvidenceError}</span>
          <button type="button" onClick={onRetry} className="underline">{copy.mediaEvidenceRetry}</button>
        </div>
      )}
    </>
  );
}
