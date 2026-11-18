import { describe, expect, it } from 'vitest';
import { canEmbedPlayer, chooseLaunchTarget } from '../../apps/web/lib/assessment-player-launch';
import { permissionsPolicy } from '../../apps/web/lib/security/permissions-policy';
import { buildCsp, httpsOriginOf } from '../../apps/web/lib/security/csp';

// D16: the portal opens a hosted launch top-level ("link-out") and frames it ONLY when the player's registered frame
// ancestors include this site AND the URL is on the configured player origin (the only one the CSP frame-src allows).
const PLAYER = 'https://player.timssuite.test';
const PORTAL = 'https://ats.example.test';
const native = (hostedUrl: string, frameAncestors: string[]) => ({
  delivery: 'native' as const,
  hostedUrl,
  frameAncestors,
});

describe('chooseLaunchTarget', () => {
  it('frames a native launch whose ancestors list this site, on the configured player origin', () => {
    expect(chooseLaunchTarget(native(`${PLAYER}/launch/c1`, [PORTAL]), PORTAL, PLAYER)).toEqual({
      kind: 'iframe',
      url: `${PLAYER}/launch/c1`,
    });
  });

  it.each([
    ['this site is not a registered ancestor', native(`${PLAYER}/launch/c1`, ['https://other.test']), PLAYER],
    ['no ancestors at all (the player sends frame-ancestors none)', native(`${PLAYER}/launch/c1`, []), PLAYER],
    ['no player origin configured (frame-src would refuse it)', native(`${PLAYER}/launch/c1`, [PORTAL]), undefined],
    ['the URL is on another origin than the configured player', native('https://elsewhere.test/l', [PORTAL]), PLAYER],
    ['an http player origin', native(`${PLAYER}/launch/c1`, [PORTAL]), 'http://player.timssuite.test'],
  ])('links out when %s', (_why, launch, player) => {
    expect(chooseLaunchTarget(launch, PORTAL, player)).toEqual({ kind: 'navigate', url: launch.hostedUrl });
  });

  it('never frames a link-out provider page when no provider frame origin is configured', () => {
    const launch = { delivery: 'link_out' as const, hostedUrl: `${PLAYER}/pca/1`, frameAncestors: [PORTAL] };
    expect(chooseLaunchTarget(launch, PORTAL, PLAYER)).toEqual({ kind: 'navigate', url: launch.hostedUrl });
  });

  // PCA, framed the way timssuite.com frames it: the provider's own site, sandboxed, only on the configured origin.
  const PROVIDER = 'https://timshr.example.test';
  const linkOut = (hostedUrl: string) => ({ delivery: 'link_out' as const, hostedUrl, frameAncestors: [] });

  it('frames a link-out page on the configured provider frame origin, sandboxed', () => {
    expect(chooseLaunchTarget(linkOut(`${PROVIDER}/surveys/?SCId=1`), PORTAL, PLAYER, PROVIDER)).toEqual({
      kind: 'iframe',
      url: `${PROVIDER}/surveys/?SCId=1`,
      sandboxed: true,
    });
  });

  it.each([
    ['the page is on another origin', linkOut('https://elsewhere.test/surveys/1'), PROVIDER],
    ['the provider frame origin is http', linkOut(`${PROVIDER}/surveys/1`), 'http://timshr.example.test'],
    ['the provider frame origin is not a URL', linkOut(`${PROVIDER}/surveys/1`), 'timshr'],
    ['the player origin is the only one configured', linkOut(`${PLAYER}/pca/1`), undefined],
  ])('links out of a provider page when %s', (_why, launch, provider) => {
    expect(chooseLaunchTarget(launch, PORTAL, PLAYER, provider)).toEqual({ kind: 'navigate', url: launch.hostedUrl });
  });

  it('never frames a native launch on the provider frame origin', () => {
    expect(chooseLaunchTarget(native(`${PROVIDER}/launch/c1`, [PORTAL]), PORTAL, PLAYER, PROVIDER)).toEqual({
      kind: 'navigate',
      url: `${PROVIDER}/launch/c1`,
    });
  });

  it.each(['http://player.timssuite.test/launch/c1', 'javascript:alert(1)', 'not a url'])(
    'never opens %s',
    (hostedUrl) => {
      expect(chooseLaunchTarget(native(hostedUrl, [PORTAL]), PORTAL, PLAYER)).toEqual({ kind: 'invalid' });
    },
  );

  it('asks for an embedded launch only when an https player origin is configured', () => {
    expect(canEmbedPlayer(PLAYER)).toBe(true);
    expect(canEmbedPlayer(undefined)).toBe(false);
    expect(canEmbedPlayer('http://player.timssuite.test')).toBe(false);
  });
});

describe('framing the player is allowed only for the configured https origin', () => {
  const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('adds the player origin to frame-src, and nothing when unset', () => {
    const withPlayer = buildCsp(
      'n',
      '/careers/acme/dashboard',
      { platformApi: '', cvUpload: '', assessmentPlayer: PLAYER },
      true,
    );
    const without = buildCsp('n', '/careers/acme/dashboard', { platformApi: '', cvUpload: '' }, true);
    expect(directive(withPlayer, 'frame-src').split(' ')).toContain(PLAYER);
    expect(directive(without, 'frame-src')).not.toContain('player');
    expect(withPlayer).toContain("frame-ancestors 'none'"); // the portal itself is never framed
  });

  it('adds the provider frame origin (PCA) to frame-src, and nothing when unset', () => {
    const provider = 'https://timshr.example.test';
    const withProvider = buildCsp(
      'n',
      '/careers/acme/dashboard',
      { platformApi: '', cvUpload: '', assessmentProviderFrame: provider },
      true,
    );
    expect(directive(withProvider, 'frame-src').split(' ')).toContain(provider);
    expect(directive(withProvider, 'frame-src')).not.toContain('player');
    expect(withProvider).toContain("frame-ancestors 'none'");
  });

  it('takes only an https origin from the env value', () => {
    expect(httpsOriginOf(`${PLAYER}/some/path`)).toBe(PLAYER);
    expect(httpsOriginOf('http://player.timssuite.test')).toBe('');
    expect(httpsOriginOf(undefined)).toBe('');
  });

  it('delegates camera and microphone to the player origin only when it is https', () => {
    expect(permissionsPolicy(undefined)).toBe('camera=(self), microphone=(self), geolocation=()');
    expect(permissionsPolicy(`${PLAYER}/x`)).toBe(
      `camera=(self "${PLAYER}"), microphone=(self "${PLAYER}"), geolocation=()`,
    );
    expect(permissionsPolicy('http://player.timssuite.test')).toBe('camera=(self), microphone=(self), geolocation=()');
    expect(permissionsPolicy('nonsense')).toBe('camera=(self), microphone=(self), geolocation=()');
  });
});
