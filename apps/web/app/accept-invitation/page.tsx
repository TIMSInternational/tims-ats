'use client';

import { Suspense } from 'react';
import { InvitationSetup } from './invitation-setup';
import { useCanonicalAuthOrigin } from '../../lib/auth/canonical-auth-origin';

export default function AcceptInvitationPage() {
  // Invitation recovery emails a PKCE link: start it on the configured origin (#50).
  useCanonicalAuthOrigin();
  return (
    <Suspense>
      <InvitationSetup />
    </Suspense>
  );
}
