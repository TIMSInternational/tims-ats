import { isCandidateConsentEnabled } from '../platform-api/candidate-consent';
import { isTenantInvitationsEnabled } from '../platform-api/tenant-invitations';
import type { NavFeatureFlag } from './manifest';

/** Resolves a nav item's `featureFlag` against the deploy-time env (NEXT_PUBLIC_*, inlined at build). */
export function isNavFeatureOn(flag: NavFeatureFlag): boolean {
  switch (flag) {
    case 'tenantInvitations':
      return isTenantInvitationsEnabled();
    case 'candidateConsent':
      return isCandidateConsentEnabled();
  }
}
