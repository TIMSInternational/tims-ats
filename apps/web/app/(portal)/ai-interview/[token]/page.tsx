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
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full text-center">
          <p className="text-sm text-[#585858]">{t.aiInterview.invalidToken}</p>
        </div>
      </div>
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
