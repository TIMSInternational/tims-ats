'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ConsentScreen } from './consent-screen';
import { VoiceRoom } from './voice-room';
import { useI18n } from '../../../../lib/i18n';

export default function AiInterviewPage() {
  const params = useParams();
  const { t } = useI18n();
  const rawToken = params.token;
  const candidateToken = typeof rawToken === 'string' && rawToken.length > 0 ? rawToken : null;
  const [consented, setConsented] = useState(false);

  if (!candidateToken) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 text-center shadow-card sm:p-8">
          <p role="alert" className="text-base text-secondary sm:text-body">{t.aiInterview.invalidToken}</p>
        </div>
      </main>
    );
  }

  if (!consented) {
    return (
      <ConsentScreen
        candidateToken={candidateToken}
        onConsented={() => setConsented(true)}
      />
    );
  }

  return <VoiceRoom candidateToken={candidateToken} />;
}
