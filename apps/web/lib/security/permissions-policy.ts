// The site-wide Permissions-Policy header (next.config.ts). Kept pure so it is unit-tested.
//
// Camera and microphone are this site's own (interviews, AI interview). When the TIMS hosted assessment player is
// configured (NEXT_PUBLIC_ASSESSMENT_PLAYER_ORIGIN, owner default D16), its https origin is delegated the same two
// features, so a player the candidate portal frames can run its face checks and audio items; the iframe also asks for
// them with `allow`. Anything that is not an https origin delegates nothing.

export function permissionsPolicy(assessmentPlayerOrigin: string | undefined): string {
  let player = '';
  if (assessmentPlayerOrigin) {
    try {
      const url = new URL(assessmentPlayerOrigin);
      if (url.protocol === 'https:') player = ` "${url.origin}"`;
    } catch {
      player = '';
    }
  }

  return `camera=(self${player}), microphone=(self${player}), geolocation=()`;
}
