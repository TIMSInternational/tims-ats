'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '../../../../../lib/i18n';

// The TIMS hosted player, framed inside the portal (D16). Rendered only when the launch listed this site's origin
// among the player's registered frame ancestors AND the URL is on the configured player origin (the only one this
// site's CSP frame-src allows): see lib/assessment-player-launch.ts. The launch asked for no return URL, so the player
// ends on its own screen; the candidate closes the dialog to return to the dashboard, which then refreshes.
// `sandboxed`: a link-out provider's own page (PCA), framed as timssuite.com frames it: scripts, forms and its own origin
// only, and no camera or microphone.
export function ProviderAssessmentFrame({
  url,
  onClose,
  sandboxed = false,
  name,
}: {
  url: string;
  onClose: () => void;
  sandboxed?: boolean;
  /** The test's name, shown in the frame's header (as timssuite.com heads its PCA frame). */
  name?: string;
}) {
  const { t } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.portalDashboard.providerFrameTitle}
      className="fixed inset-0 z-50 flex flex-col bg-white"
    >
      <div className="flex items-center justify-between border-b border-[#EDEDED] px-4 h-12">
        <p className="min-w-0 truncate text-[12px] text-[#585858]">
          {name && <span className="font-semibold text-[#1F114C]">{name} · </span>}
          {t.portalDashboard.providerFrameHint}
        </p>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold text-[#1F114C] hover:underline"
        >
          {t.portalDashboard.providerFrameClose}
        </button>
      </div>
      <iframe
        src={url}
        title={t.portalDashboard.providerFrameTitle}
        className="flex-1 w-full border-0"
        allow={sandboxed ? 'fullscreen' : 'camera; microphone; fullscreen; autoplay'}
        sandbox={sandboxed ? 'allow-forms allow-scripts allow-same-origin allow-popups' : undefined}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}
