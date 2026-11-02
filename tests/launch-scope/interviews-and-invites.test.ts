import { describe, expect, it } from 'vitest';
import {
  availableInterviewTypes,
  defaultInterviewType,
  isInterviewVideoEnabled,
  locationPayload,
} from '../../apps/web/app/(admin)/recruitment/interviews/schedule-modal.helpers';
import {
  canOfferInterviewCancel,
  resolveCancelReason,
} from '../../apps/web/app/(admin)/recruitment/interviews/interview-cancel';
import { isInviteRoleValid, rowsMissingRole } from '../../apps/web/lib/invitations/invite-role';
import { loginErrorMessage } from '../../apps/web/app/(auth)/login/login-error-message';
import es from '../../apps/web/lib/i18n/es.json';

describe('interview video flag', () => {
  it('is off unless exactly "true"', () => {
    expect(isInterviewVideoEnabled(undefined)).toBe(false);
    expect(isInterviewVideoEnabled('1')).toBe(false);
    expect(isInterviewVideoEnabled('true')).toBe(true);
  });

  it('off: no video option and on-site by default', () => {
    expect(availableInterviewTypes(false).map((t) => t.value)).not.toContain('video');
    expect(defaultInterviewType(false)).toBe('onsite');
  });

  it('on: video offered and still the default', () => {
    expect(availableInterviewTypes(true).map((t) => t.value)).toContain('video');
    expect(defaultInterviewType(true)).toBe('video');
  });
});

describe('location → meetingUrl mapping', () => {
  it('sends an https link as meetingUrl and keeps it as location', () => {
    expect(locationPayload('  https://meet.google.com/abc-defg-hij ')).toEqual({
      location: 'https://meet.google.com/abc-defg-hij',
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
  });

  it('keeps plain text, http and other schemes as location only', () => {
    expect(locationPayload('Oficina San José, Sala 3')).toEqual({ location: 'Oficina San José, Sala 3' });
    expect(locationPayload('http://meet.example.com/x')).toEqual({ location: 'http://meet.example.com/x' });
    expect(locationPayload('javascript:alert(1)')).toEqual({ location: 'javascript:alert(1)' });
    expect(locationPayload('https://zoom.us/j/1 sala 2')).toEqual({ location: 'https://zoom.us/j/1 sala 2' });
  });

  it('sends nothing for a blank field', () => {
    expect(locationPayload('   ')).toEqual({});
  });
});

describe('committee cancel guardrail', () => {
  it('hides Cancel for committee-only users', () => {
    expect(canOfferInterviewCancel(['committee'], true)).toBe(false);
    expect(canOfferInterviewCancel(['committee', 'employee'], true)).toBe(false);
  });

  it('shows Cancel for interview managers, even when they also sit on committees', () => {
    for (const role of ['recruiter', 'hr_admin', 'hrbp', 'leader', 'super_admin']) {
      expect(canOfferInterviewCancel([role], true)).toBe(true);
      expect(canOfferInterviewCancel([role, 'committee'], true)).toBe(true);
    }
  });

  it('hides Cancel without interview:update', () => {
    expect(canOfferInterviewCancel(['recruiter'], false)).toBe(false);
  });

  it('defaults the reason to the Spanish copy and bounds it', () => {
    const fallback = es.interviews.cancelReasonDefault;
    expect(fallback).toBe('Cancelada por el equipo de reclutamiento');
    expect(resolveCancelReason('   ', fallback)).toBe(fallback);
    expect(resolveCancelReason(' Candidato no disponible ', fallback)).toBe('Candidato no disponible');
    expect(resolveCancelReason('x'.repeat(2000), fallback)).toHaveLength(1000);
  });
});

describe('invite role is required', () => {
  it('rejects a blank role and accepts a slug', () => {
    expect(isInviteRoleValid('')).toBe(false);
    expect(isInviteRoleValid('   ')).toBe(false);
    expect(isInviteRoleValid(undefined)).toBe(false);
    expect(isInviteRoleValid('recruiter')).toBe(true);
    expect(isInviteRoleValid('x'.repeat(51))).toBe(false);
  });

  it('reports bulk rows without a role (1-based)', () => {
    expect(rowsMissingRole([{ role: 'recruiter' }, {}, { role: ' ' }])).toEqual([2, 3]);
    expect(rowsMissingRole([{ role: 'employee' }])).toEqual([]);
  });
});

describe('staff login callback error copy', () => {
  it('maps callback errors to Spanish messages', () => {
    expect(loginErrorMessage('auth_callback_error', es.auth)).toBe(es.auth.callbackError);
    expect(loginErrorMessage('registration_closed', es.auth)).toBe(es.auth.registrationClosed);
    expect(loginErrorMessage(null, es.auth)).toBeNull();
    expect(loginErrorMessage('other', es.auth)).toBeNull();
  });

  it('carries the portal link-expired message verbatim', () => {
    expect(es.portalAuth.linkExpired).toBe('El enlace expiró o se abrió en otro navegador. Solicita uno nuevo.');
  });
});
