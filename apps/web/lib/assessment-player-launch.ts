// Where the candidate portal opens a hosted assessment launch (owner default D16). Pure, so every branch is unit-tested.
//
// The TIMS hosted player may be framed only by the partner's REGISTERED origins: the launch returns them as
// `frameAncestors`, and the player sends exactly those in its `Content-Security-Policy: frame-ancestors`. The portal frames
// it only when ALL hold:
//   - it is a native launch (a link-out provider page is never framed),
//   - this page's origin is one of the registered frame ancestors (otherwise the player would refuse to render),
//   - the player URL is on the configured player origin (the only one this site's CSP `frame-src` allows).
// A link-out provider page (PCA, on the provider's own site) is framed the way timssuite.com frames it, in a sandboxed
// frame, only when its origin is the configured provider frame origin (NEXT_PUBLIC_ASSESSMENT_PROVIDER_FRAME_ORIGIN, the
// other origin this site's CSP frame-src allows); `sandboxed` marks it.
// Otherwise the candidate is sent to the URL top-level (a "link-out"), in the same tab: a new tab opened after the
// asynchronous launch would be blocked as a pop-up. Anything that is not an https URL is never opened.

export type LaunchTarget =
  | { kind: 'iframe'; url: string; sandboxed?: true }
  | { kind: 'navigate'; url: string }
  | { kind: 'invalid' };

export interface HostedLaunch {
  delivery: 'native' | 'link_out';
  hostedUrl: string;
  frameAncestors: readonly string[];
}

function httpsOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** True when the portal intends to frame the player, so the launch asks for no return URL. */
export function canEmbedPlayer(playerOrigin: string | undefined | null): boolean {
  return httpsOrigin(playerOrigin) !== null;
}

export function chooseLaunchTarget(
  launch: HostedLaunch,
  pageOrigin: string,
  playerOrigin: string | undefined | null,
  providerFrameOrigin?: string | null,
): LaunchTarget {
  const urlOrigin = httpsOrigin(launch.hostedUrl);
  if (urlOrigin === null) return { kind: 'invalid' };
  if (launch.delivery === 'link_out') {
    const provider = httpsOrigin(providerFrameOrigin);
    return provider !== null && urlOrigin === provider
      ? { kind: 'iframe', url: launch.hostedUrl, sandboxed: true }
      : { kind: 'navigate', url: launch.hostedUrl };
  }
  const allowedPlayer = httpsOrigin(playerOrigin);
  const framable =
    launch.delivery === 'native' &&
    allowedPlayer !== null &&
    urlOrigin === allowedPlayer &&
    launch.frameAncestors.includes(pageOrigin);
  return framable ? { kind: 'iframe', url: launch.hostedUrl } : { kind: 'navigate', url: launch.hostedUrl };
}

/** Top-level navigation to a hosted launch (a seam the component tests replace). */
export function openTopLevel(url: string): void {
  window.location.assign(url);
}
