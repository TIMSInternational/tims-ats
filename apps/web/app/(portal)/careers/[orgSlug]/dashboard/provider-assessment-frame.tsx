'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { frameMessages } from './provider-frame-messages';

// A TIMS test, framed full screen inside the portal (D16). Two kinds:
//  - the TIMS hosted player (LIA, English, Personality): it draws timssuite.com's own test screens, so this frame adds
//    only a slim bar with the test's name and a way out. When the sitting ends the player posts `sitting_ended` to this
//    page (only to origins TIMS registered for the ATS); the frame then closes itself and the dashboard refreshes.
//  - `sandboxed`: the PCA, answered on TIMS's own site (timshr.com), framed exactly as timssuite.com frames it: its
//    header ("Análisis de Competencias Personales (PCA)" · "Completa el cuestionario a continuación"), scripts, forms and
//    its own origin only, no camera or microphone. TIMS's page sends no message, so the dashboard polls for completion.
// Leaving a test in progress always asks first (Escape included): a sitting keeps its answers, but a timed section keeps
// running on the server. The bar and the leave question speak the TEST's language (`locale`), not the portal's.
export const PLAYER_MESSAGE_SOURCE = 'tims-hosted-player';

export function isSittingEndedMessage(event: MessageEvent, playerOrigin: string | undefined): boolean {
  if (!playerOrigin || event.origin !== playerOrigin) return false;
  const data = event.data as unknown;
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>).source === PLAYER_MESSAGE_SOURCE &&
    (data as Record<string, unknown>).type === 'sitting_ended'
  );
}

export function ProviderAssessmentFrame({
  url,
  onClose,
  onFinished,
  sandboxed = false,
  name,
  playerOrigin,
  finished = false,
  locale,
}: {
  url: string;
  /** The candidate left (after confirming). */
  onClose: () => void;
  /** The sitting ended inside the frame. */
  onFinished: () => void;
  sandboxed?: boolean;
  /** The test's name, shown in the bar. */
  name?: string;
  /** The hosted player's origin: the only sender trusted for `sitting_ended`. */
  playerOrigin?: string;
  /** The sitting ended: the player shows the suite's receipt; the way out no longer asks. */
  finished?: boolean;
  /** The language the test is administered in (the attempt's locale); unknown or absent: the portal's language. */
  locale?: string;
}) {
  const { t } = useI18n();
  const leaveRef = useRef<HTMLButtonElement>(null);
  const stayRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    leaveRef.current?.focus();
  }, [finished]);

  useEffect(() => {
    if (confirming) stayRef.current?.focus();
  }, [confirming]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // After the end nothing is at stake: Escape returns. During a test, Escape asks; a second Escape keeps the
      // candidate in the test (the safe choice).
      if (finished) onClose();
      else setConfirming((open) => !open);
    };
    const onMessage = (event: MessageEvent) => {
      if (isSittingEndedMessage(event, playerOrigin)) onFinished();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('message', onMessage);
    };
  }, [onFinished, onClose, playerOrigin, finished]);

  const m = frameMessages(locale, t.portalDashboard);
  const leaveButton = finished ? (
    // The sitting is over and the suite's receipt is on screen: one clear way back, no question asked.
    <button
      ref={leaveRef}
      type="button"
      onClick={onClose}
      className="inline-flex items-center min-h-11 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#150D33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C]"
    >
      {m.providerFrameDone}
    </button>
  ) : (
    <button
      ref={leaveRef}
      type="button"
      onClick={() => setConfirming(true)}
      className="inline-flex items-center min-h-11 px-3 -mr-3 rounded-lg text-sm font-medium text-[#1F114C] hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C]"
    >
      {m.providerFrameLeave}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name ?? m.providerFrameTitle}
      className="fixed inset-0 z-50 flex flex-col bg-gray-50"
    >
      {sandboxed ? (
        // timssuite.com's PCA header (PCAEvaluation.tsx), plus the way out.
        <div className="bg-white shadow-sm px-4 py-3 flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold text-gray-900 truncate">{m.providerPcaFrameTitle}</h1>
          <div className="flex items-center gap-4 shrink-0">
            <p className="hidden sm:block text-sm text-gray-500">{m.providerPcaFrameHint}</p>
            {leaveButton}
          </div>
        </div>
      ) : (
        <div className="bg-white border-b border-gray-200 px-4 h-11 flex items-center justify-between gap-4">
          <p className="min-w-0 truncate text-sm font-medium text-gray-900">{name ?? m.providerFrameTitle}</p>
          {leaveButton}
        </div>
      )}
      {confirming && !finished && (
        <div
          role="alertdialog"
          aria-labelledby="provider-leave-title"
          aria-describedby="provider-leave-body"
          className="bg-white border-b border-gray-200 px-4 py-3 flex flex-wrap items-center gap-3"
        >
          <div className="min-w-0 flex-1">
            <p id="provider-leave-title" className="text-sm font-semibold text-gray-900">
              {m.providerLeaveTitle}
            </p>
            <p id="provider-leave-body" className="text-sm text-gray-600">
              {m.providerLeaveBody}
            </p>
          </div>
          <button
            ref={stayRef}
            type="button"
            onClick={() => setConfirming(false)}
            className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#150D33] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C]"
          >
            {m.providerLeaveStay}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center min-h-11 px-4 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F114C]"
          >
            {m.providerLeaveConfirm}
          </button>
        </div>
      )}
      <iframe
        src={url}
        title={name ?? m.providerFrameTitle}
        className="flex-1 w-full border-0"
        allow={sandboxed ? 'fullscreen' : 'camera; microphone; fullscreen; autoplay'}
        sandbox={sandboxed ? 'allow-forms allow-scripts allow-same-origin' : undefined}
        referrerPolicy={sandboxed ? 'strict-origin-when-cross-origin' : 'no-referrer'}
      />
    </div>
  );
}

