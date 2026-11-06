'use client';

import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import {
  acknowledgeTranscription,
  isTranscriptionAvailable,
} from '../../../../../../lib/platform-api/interview-transcription';

/**
 * The evaluator's side of the transcription notice. When transcription is available for this (video) interview,
 * joining the call requires ticking the notice; the acknowledgement is recorded server-side once per visit. A
 * failed record never blocks the call — it only means this evaluator cannot START the transcript (the server
 * refuses without it). No React Query here: the room renders without a query client while the feature is dark.
 */
export function useTranscriptionNotice(interviewId: string, isVideo: boolean) {
  const { t } = useI18n();
  const enabled = isVideo && isTranscriptionAvailable();
  const [accepted, setAccepted] = useState(false);
  const recorded = useRef(false);
  const record = useCallback(async () => {
    if (!enabled || !accepted || recorded.current) return;
    recorded.current = true;
    try {
      await acknowledgeTranscription(interviewId);
    } catch {
      recorded.current = false;
      toast(t.interviewTranscription.ackFailed, { type: 'error' });
    }
  }, [enabled, accepted, interviewId, t]);
  return { enabled, accepted, setAccepted, record, mayJoin: !enabled || accepted };
}

interface TranscriptionNoticeProps {
  accepted: boolean;
  onAcceptedChange: (accepted: boolean) => void;
  disabled?: boolean;
}

export function TranscriptionNotice({ accepted, onAcceptedChange, disabled = false }: TranscriptionNoticeProps) {
  const { t } = useI18n();
  const copy = t.interviewTranscription;
  return (
    <div
      className="mx-auto mb-5 max-w-sm rounded-lg border border-white/15 bg-white/5 p-3 text-left"
      data-testid="transcription-notice"
    >
      <p className="text-[12px] font-semibold text-white">{copy.noticeTitle}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-white/70">{copy.noticeBody}</p>
      <label className="mt-2 flex items-start gap-2 text-[11px] text-white/90">
        <input
          type="checkbox"
          checked={accepted}
          disabled={disabled}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          className="mt-0.5"
        />
        <span>{copy.noticeCheckbox}</span>
      </label>
      {!accepted && <p className="mt-1 text-[10px] text-white/50">{copy.noticeRequired}</p>}
    </div>
  );
}
