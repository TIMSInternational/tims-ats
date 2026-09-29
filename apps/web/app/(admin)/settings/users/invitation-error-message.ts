import { PlatformApiError } from '../../../../lib/platform-api/client';
import { TenantInvitationsUnavailableError } from '../../../../lib/platform-api/tenant-invitations';

export type InvitationOperation = 'read' | 'create' | 'resend' | 'revoke';

export interface InvitationErrorMessages {
  errorForbidden: string;
  errorDuplicate: string;
  errorNotFound: string;
  errorInvalid: string;
  errorChanged: string;
  errorDeliveryUnconfirmed: string;
  errorGeneric: string;
  unavailableMessage: string;
}

/**
 * True when the surface itself is off: the client-side flag/URL is missing, or the C# endpoint is
 * not mapped (a GET 404 — `Platform__TenantInvitationsEnabled` off). Pure; unit-tested directly.
 */
export function isInvitationSurfaceUnavailable(error: unknown): boolean {
  if (error instanceof TenantInvitationsUnavailableError) return true;
  return error instanceof PlatformApiError && error.status === 404;
}

export function isInvitationForbidden(error: unknown): boolean {
  return error instanceof PlatformApiError && (error.status === 401 || error.status === 403);
}

/**
 * Maps a tenant-invitation failure to an i18n message. Backend `{message}` text is deliberately NOT
 * shown: it is not localized, and every status in the contract has a clear translated meaning.
 */
export function invitationErrorMessage(
  error: unknown,
  operation: InvitationOperation,
  m: InvitationErrorMessages,
): string {
  if (error instanceof TenantInvitationsUnavailableError) return m.unavailableMessage;
  if (!(error instanceof PlatformApiError)) return m.errorGeneric;
  switch (error.status) {
    case 400:
      return m.errorInvalid;
    case 401:
    case 403:
      return m.errorForbidden;
    case 404:
      return operation === 'resend' || operation === 'revoke' ? m.errorNotFound : m.unavailableMessage;
    case 409:
      return operation === 'create' ? m.errorDuplicate : m.errorChanged;
    case 503:
      return operation === 'resend' || operation === 'create' ? m.errorDeliveryUnconfirmed : m.errorGeneric;
    default:
      return m.errorGeneric;
  }
}
