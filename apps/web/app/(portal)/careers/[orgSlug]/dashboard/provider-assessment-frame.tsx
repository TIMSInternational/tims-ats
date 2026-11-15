'use client';

import { useEffect, useRef, useState } from 'react';
import { formatMessage, useI18n } from '../../../../../lib/i18n';
import { frameMessages } from './provider-frame-messages';
import { Button, Spinner, buttonClasses } from '../../../../../components';

// A TIMS test, framed full screen inside the portal (D16), under ONE bar for every test: the test's name and a way out.
// Two kinds:
//  - the TIMS hosted player (LIA, English, Personality): it draws timssuite.com's own test screens. When the sitting
//    ends the player posts `sitting_ended` to this page (only to origins TIMS registered for the ATS); the frame then
//    keeps the suite's receipt on screen and offers one way back.
//  - `sandboxed`: the PCA, answered on TIMS's own site (timshr.com), framed as timssuite.com frames it: scripts, forms
//    and its own origin only, no camera, microphone or pop-ups. TIMS's page sends no message, so the dashboard polls for
//    completion (in a new tab too). Its bar adds "Abrir en una pestaña nueva", for a browser that will not show TIMS's
//    page inside the frame.
// Until the framed page has loaded, a spinner with a short description covers the frame (loading.md › Best practices:
// "Show something as soon as possible").
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
  // The URL whose page has loaded (not a boolean: a new URL starts loading again).
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loading = loadedUrl !== url;

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
  const title = name ?? m.providerFrameTitle;
  const leaveButton = finished ? (
    // The sitting is over and the suite's receipt is on screen: one clear way back, no question asked.
    <Button ref={leaveRef} onClick={onClose}>
      {m.providerFrameDone}
    </Button>
  ) : (
    <Button ref={leaveRef} variant="tertiary" onClick={() => setConfirming(true)}>
      {m.providerFrameLeave}
    </Button>
  );

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 py-2">
        <p className="min-w-0 truncate text-subheading font-medium text-primary">{title}</p>
        <div className="flex shrink-0 items-center gap-2">
          {sandboxed && !finished && (
            // Only the provider page: the hosted player's launch code is single-use (the frame has spent it) and its
            // camera, microphone and full screen are granted to this frame. Below sm the label stays the accessible
            // name and the familiar "open outside" symbol carries it (buttons.md › Content, toolbars.md › Phone).
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClasses({ variant: 'tertiary', className: 'max-sm:px-3 pointer-coarse:min-w-11' })}
            >
              <svg
                className="size-5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
              <span className="max-sm:sr-only">{m.providerFrameNewTab}</span>
            </a>
          )}
          {leaveButton}
        </div>
      </div>
      {confirming && !finished && (
        <div
          role="alertdialog"
          aria-labelledby="provider-leave-title"
          aria-describedby="provider-leave-body"
          className="flex flex-wrap items-center gap-3 border-b border-border bg-white px-4 py-3"
        >
          <div className="min-w-0 flex-1">
            <p id="provider-leave-title" className="text-subheading font-semibold text-primary">
              {m.providerLeaveTitle}
            </p>
            <p id="provider-leave-body" className="text-body text-secondary">
              {m.providerLeaveBody}
            </p>
          </div>
          <Button variant="secondary" onClick={onClose}>
            {m.providerLeaveConfirm}
          </Button>
          <Button ref={stayRef} onClick={() => setConfirming(false)}>
            {m.providerLeaveStay}
          </Button>
        </div>
      )}
      <div className="relative min-h-0 flex-1" aria-busy={loading || undefined}>
        <iframe
          src={url}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow={sandboxed ? 'fullscreen' : 'camera; microphone; fullscreen; autoplay'}
          sandbox={sandboxed ? 'allow-forms allow-scripts allow-same-origin' : undefined}
          referrerPolicy={sandboxed ? 'strict-origin-when-cross-origin' : 'no-referrer'}
          onLoad={() => setLoadedUrl(url)}
        />
        {loading && (
          // Never catches a click meant for the page underneath; gone at the frame's first load event.
          <div
            role="status"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white px-6 text-center"
          >
            <Spinner className="size-6 text-brand" />
            <p className="text-body text-secondary">{formatMessage(m.providerFrameOpening, { name: title })}</p>
          </div>
        )}
      </div>
    </div>
  );
}
