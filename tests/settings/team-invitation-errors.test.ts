import { describe, expect, it } from 'vitest';
import { PlatformApiError } from '../../apps/web/lib/platform-api/client';
import { TenantInvitationsUnavailableError } from '../../apps/web/lib/platform-api/tenant-invitations';
import {
  invitationErrorMessage,
  isInvitationForbidden,
  isInvitationSurfaceUnavailable,
} from '../../apps/web/app/(admin)/settings/users/invitation-error-message';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

const m = es.teamSettings;
const api = (status: number) => new PlatformApiError(status, 'x', { message: 'backend text' });

describe('invitationErrorMessage', () => {
  it.each([
    [409, 'create', m.errorDuplicate],
    [403, 'create', m.errorForbidden],
    [401, 'read', m.errorForbidden],
    [400, 'create', m.errorInvalid],
    [404, 'resend', m.errorNotFound],
    [404, 'revoke', m.errorNotFound],
    [404, 'read', m.unavailableMessage],
    [409, 'resend', m.errorChanged],
    [429, 'resend', m.errorResendCooldown],
    [429, 'create', m.errorGeneric],
    [503, 'resend', m.errorDeliveryUnconfirmed],
    [500, 'revoke', m.errorGeneric],
  ] as const)('%i on %s maps to its translated message', (status, op, expected) => {
    expect(invitationErrorMessage(api(status), op, m)).toBe(expected);
  });

  it('never surfaces the untranslated backend message', () => {
    for (const status of [400, 403, 404, 409, 429, 500, 503])
      expect(invitationErrorMessage(api(status), 'create', m)).not.toBe('backend text');
  });

  it('maps the client-side flag-off error to the unavailable message and unknown errors to generic', () => {
    expect(invitationErrorMessage(new TenantInvitationsUnavailableError(), 'read', m)).toBe(m.unavailableMessage);
    expect(invitationErrorMessage(new Error('network'), 'create', m)).toBe(m.errorGeneric);
  });

  it('classifies unavailable and forbidden states', () => {
    expect(isInvitationSurfaceUnavailable(new TenantInvitationsUnavailableError())).toBe(true);
    expect(isInvitationSurfaceUnavailable(api(404))).toBe(true);
    expect(isInvitationSurfaceUnavailable(api(403))).toBe(false);
    expect(isInvitationForbidden(api(403))).toBe(true);
    expect(isInvitationForbidden(api(409))).toBe(false);
  });

  it('every teamSettings key exists, non-empty, in both es and en', () => {
    expect(Object.keys(en.teamSettings).sort()).toEqual(Object.keys(es.teamSettings).sort());
    for (const value of [...Object.values(es.teamSettings), ...Object.values(en.teamSettings)])
      expect(value).toBeTruthy();
  });
});
