'use client';

import { Suspense } from 'react';
import { InvitationSetup } from './invitation-setup';

export default function AcceptInvitationPage() {
  return (
    <Suspense>
      <InvitationSetup />
    </Suspense>
  );
}
