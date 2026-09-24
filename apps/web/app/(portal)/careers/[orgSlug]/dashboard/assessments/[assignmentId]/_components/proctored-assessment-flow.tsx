'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '../../../../../../../../lib/trpc';
import { useI18n } from '../../../../../../../../lib/i18n';
import {
  completeCandidateProctoring,
  useProctoringCapability,
  useStartCandidateProctoring,
} from '../../../../../../../../lib/platform-api/proctoring';
import { AssessmentBackLink } from './assessment-back-link';
import { AssessmentQuestionWizard } from './assessment-question-wizard';
import { ProctoringPreflight } from './proctoring-preflight';
import { stopProctoringMedia, type ProctoringMedia } from './proctoring-media';
import { ProctoringMonitor } from './proctoring-monitor';
import { ProctoringResumeTimer } from './proctoring-resume-timer';

interface ProctoredAssessmentFlowProps {
  orgSlug: string;
  assignmentId: string;
  status: string;
  existingStartedAt: Date | null;
  expiresAt: Date | null;
  durationMinutes: number | null;
  onSubmitted: () => void;
}

const SUBMISSION_FLUSH_TIMEOUT_MS = 2_000;

async function waitForBestEffortFlush(flush: (() => Promise<void>) | null) {
  if (!flush) return;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      flush(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, SUBMISSION_FLUSH_TIMEOUT_MS);
      }),
    ]);
  } catch {
    // An event sync failure cannot undo already submitted answers.
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function ProctoredAssessmentFlow({
  orgSlug,
  assignmentId,
  status,
  existingStartedAt,
  expiresAt,
  durationMinutes,
  onSubmitted,
}: ProctoredAssessmentFlowProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [media, setMedia] = useState<ProctoringMedia | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [completionError, setCompletionError] = useState(false);
  const latestMedia = useRef<ProctoringMedia | null>(null);
  const flushRef = useRef<(() => Promise<void>) | null>(null);
  const finishingRef = useRef(false);
  const capability = useProctoringCapability();
  const start = useStartCandidateProctoring();

  const registerFlush = useCallback((flush: (() => Promise<void>) | null) => {
    flushRef.current = flush;
  }, []);

  useEffect(
    () => () => {
      if (latestMedia.current) stopProctoringMedia(latestMedia.current);
    },
    [],
  );

  const onAuthorized = async (): Promise<Date> => {
    const result = await start.mutateAsync({
      orgSlug,
      assignmentId,
      assessmentConsentAccepted: true,
      proctoringConsentAccepted: true,
      capabilities: { camera: true, screen: true },
    });
    return result.startedAt;
  };

  const finishMonitoring = async () => {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setSubmitted(true);
    setCompletionError(false);
    if (latestMedia.current) stopProctoringMedia(latestMedia.current);
    latestMedia.current = null;
    try {
      await waitForBestEffortFlush(flushRef.current);
      await completeCandidateProctoring({ orgSlug, assignmentId });
      onSubmitted();
    } catch {
      setCompletionError(true);
    } finally {
      finishingRef.current = false;
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-6 max-w-lg w-full space-y-3 text-center">
          <p className="text-[13px] text-[#585858]" role="status">
            {completionError ? t.proctoring.candidate.finishError : t.proctoring.candidate.finishing}
          </p>
          {completionError && (
            <button
              type="button"
              onClick={() => void finishMonitoring()}
              className="rounded-xl bg-[#1F114C] px-5 py-2.5 text-white text-sm font-semibold"
            >
              {t.proctoring.candidate.retryFinish}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!startedAt || !media) {
    const availabilityGate = capability.isLoading ? (
      <p className="text-center text-[13px] p-8" role="status">{t.proctoring.candidate.serviceChecking}</p>
    ) : capability.isError ? (
        <div className="p-8 text-center space-y-3">
          <p className="text-[13px] text-[#B42318]" role="alert">{t.proctoring.candidate.serviceError}</p>
          <button type="button" onClick={() => void capability.refetch()} className="rounded-xl border border-[#1F114C] px-4 py-2 text-sm text-[#1F114C]">
            {t.proctoring.candidate.retryService}
          </button>
        </div>
    ) : capability.data?.enabled !== true ? (
      <p className="text-center text-[13px] text-[#B42318] p-8" role="alert">{t.proctoring.candidate.serviceUnavailable}</p>
    ) : null;
    return (
      <>
        <AssessmentBackLink orgSlug={orgSlug} />
        {status === 'in_progress' && existingStartedAt && (
          <ProctoringResumeTimer
            startedAt={existingStartedAt}
            expiresAt={expiresAt}
            durationMinutes={durationMinutes}
          />
        )}
        {availabilityGate ?? (
          <ProctoringPreflight
            isResume={status === 'in_progress'}
            onAuthorize={onAuthorized}
            onReady={(readyMedia, started) => {
              latestMedia.current = readyMedia;
              setMedia(readyMedia);
              setStartedAt(started);
              void utils.candidatePortal.getMyAssessments.invalidate();
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] p-4">
      <div className="max-w-2xl mx-auto mb-3">
        <ProctoringMonitor
          orgSlug={orgSlug}
          assignmentId={assignmentId}
          initialMedia={media}
          onMediaChange={(updated) => {
            latestMedia.current = updated;
          }}
          onRegisterFlush={registerFlush}
        />
      </div>
      <AssessmentQuestionWizard
        orgSlug={orgSlug}
        assignmentId={assignmentId}
        startedAt={startedAt}
        expiresAt={expiresAt}
        durationMinutes={durationMinutes}
        onSubmitted={() => void finishMonitoring()}
      />
    </div>
  );
}
