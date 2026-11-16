'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { formatMessage, useI18n } from '../../../../../lib/i18n';
import { frameMessages } from './provider-frame-messages';
import { ProviderFrameBrand } from './provider-frame-brand';
import { ProviderFrameLeave } from './provider-frame-leave';
import {
  FRAME_BODY_CLASSES,
  FRAME_DIVIDER_CLASSES,
  FRAME_DONE_CLASSES,
  FRAME_DONE_FULL_CLASSES,
  FRAME_DONE_SHORT_CLASSES,
  FRAME_HEADER_CLASSES,
  FRAME_HEADER_END_CLASSES,
  FRAME_HEADER_START_CLASSES,
  FRAME_IFRAME_CLASSES,
  FRAME_LEAVE_CLASSES,
  FRAME_LOADING_CLASSES,
  FRAME_LOADING_PLAYER_CLASSES,
  FRAME_LOADING_SHEET_CLASSES,
  FRAME_LOADING_TEXT_CLASSES,
  FRAME_NEW_TAB_CLASSES,
  FRAME_NEW_TAB_LABEL_CLASSES,
  FRAME_ROOT_CLASSES,
  FRAME_SPINNER_CLASSES,
  FRAME_TITLE_CLASSES,
} from './provider-frame-styles';

// A TIMS test, framed full screen inside the portal (D16), under ONE bar for every test: the test's name and a way out.
// Two kinds:
//  - the TIMS hosted player (LIA, English, Personality): it draws timssuite.com's own test screens. When the sitting
//    ends the player posts `sitting_ended` to this page (only to origins TIMS registered for the ATS); the frame then
//    keeps the suite's receipt on screen and offers one way back.
//  - `sandboxed`: the PCA, answered on TIMS's own site (timshr.com), framed as timssuite.com frames it: scripts, forms
//    and its own origin only, no camera, microphone or pop-ups. TIMS's page sends no message, so the dashboard polls for
//    completion (in a new tab too). Its bar adds "Abrir en una pestaña nueva", for a browser that will not show TIMS's
//    page inside the frame.
// The bar is the TIMS evaluation design's navy header, on the same navy page the test's own screens use, so frame and
// test read as one screen. The brand ("TIMS International" + mark) has ONE owner: the hosted player draws its own PCA
// header with it, so over the player the bar carries only the test's name and the way out; the sandboxed provider page
// has no TIMS header, so there the bar adds the brand.
// Until the framed page has loaded, the evaluation's white sheet with a spinner and a short description covers the frame
// (loading.md › Best practices: "Show something as soon as possible").
// Leaving a test in progress always asks first (Escape included): a sitting keeps its answers, but a timed section keeps
// running on the server. While it asks, the bar and the test are inert behind the scrim. The bar and the leave question
// speak the TEST's language (`locale`), not the portal's.
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
  // The URL whose page has loaded (not a boolean: a new URL starts loading again).
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loading = loadedUrl !== url;

  useEffect(() => {
    leaveRef.current?.focus();
  }, [finished]);

  useEffect(() => {
    // Asking: staying is focused. Answered "stay" (or Escape): focus returns to the way out it came from.
    if (confirming) stayRef.current?.focus();
    else leaveRef.current?.focus();
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
  const title = name ?? m.providerFrameTitle;
  const leaveButton = finished ? (
    // The sitting is over and the suite's receipt is on screen: one clear way back, no question asked.
    <button type="button" ref={leaveRef} className={FRAME_DONE_CLASSES} onClick={onClose}>
      <span className={FRAME_DONE_FULL_CLASSES}>{m.providerFrameDone}</span>
      <span aria-hidden="true" className={FRAME_DONE_SHORT_CLASSES}>
        {m.providerFrameDoneShort}
      </span>
    </button>
  ) : (
    <button type="button" ref={leaveRef} className={FRAME_LEAVE_CLASSES} onClick={() => setConfirming(true)}>
      {m.providerFrameLeave}
    </button>
  );
  const asking = confirming && !finished;

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className={FRAME_ROOT_CLASSES}>
      <div className={FRAME_HEADER_CLASSES} inert={asking || undefined}>
        <div className={FRAME_HEADER_START_CLASSES}>
          {sandboxed && (
            <>
              <ProviderFrameBrand label={m.providerFrameBrand} />
              <span aria-hidden="true" className={FRAME_DIVIDER_CLASSES} />
            </>
          )}
          <p className={FRAME_TITLE_CLASSES}>{title}</p>
        </div>
        <div className={FRAME_HEADER_END_CLASSES}>
          {sandboxed && !finished && (
            // Only the provider page: the hosted player's launch code is single-use (the frame has spent it) and its
            // camera, microphone and full screen are granted to this frame. Below sm the label stays the accessible
            // name and the familiar "open outside" symbol carries it (buttons.md › Content, toolbars.md › Phone).
            <a href={url} target="_blank" rel="noopener noreferrer" className={FRAME_NEW_TAB_CLASSES}>
              <ExternalLink aria-hidden="true" />
              <span className={FRAME_NEW_TAB_LABEL_CLASSES}>{m.providerFrameNewTab}</span>
            </a>
          )}
          {leaveButton}
        </div>
      </div>
      <div className={FRAME_BODY_CLASSES} aria-busy={loading || undefined} inert={asking || undefined}>
        <iframe
          src={url}
          title={title}
          className={FRAME_IFRAME_CLASSES}
          allow={sandboxed ? 'fullscreen' : 'camera; microphone; fullscreen; autoplay'}
          sandbox={sandboxed ? 'allow-forms allow-scripts allow-same-origin' : undefined}
          referrerPolicy={sandboxed ? 'strict-origin-when-cross-origin' : 'no-referrer'}
          onLoad={() => setLoadedUrl(url)}
        />
        {loading && (
          // Never catches a click meant for the page underneath; gone at the frame's first load event.
          <div role="status" className={sandboxed ? FRAME_LOADING_CLASSES : FRAME_LOADING_PLAYER_CLASSES}>
            <div className={FRAME_LOADING_SHEET_CLASSES}>
              <span aria-hidden="true" className={FRAME_SPINNER_CLASSES} />
              <p className={FRAME_LOADING_TEXT_CLASSES}>{formatMessage(m.providerFrameOpening, { name: title })}</p>
            </div>
          </div>
        )}
      </div>
      {asking && (
        <ProviderFrameLeave
          eyebrow={m.providerLeaveEyebrow}
          title={m.providerLeaveTitle}
          body={m.providerLeaveBody}
          confirmLabel={m.providerLeaveConfirm}
          stayLabel={m.providerLeaveStay}
          stayRef={stayRef}
          onConfirm={onClose}
          onStay={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
