'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button } from '../../../../components/button';
import { useMicLevel } from './use-mic-level';
import { ParticipantTile } from './participant-tile';

interface LobbyProps {
  onJoin: () => void;
  joining: boolean;
  error: string | null;
}

export function Lobby({ onJoin, joining, error }: LobbyProps) {
  const { t } = useI18n();
  const { level, blocked } = useMicLevel(true);
  const hearing = level > 0.05;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0E0A1F] p-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-2xl bg-[#160f2e] p-6 sm:p-8">
        <h1 className="text-center font-display text-heading font-semibold text-white">{t.aiInterview.lobbyHeading}</h1>

        <div className="flex w-full flex-col items-center gap-2">
          <p className="text-callout font-medium text-[#cfc8ea]">{t.aiInterview.lobbyMicCheck}</p>
          <div className="w-40">
            <ParticipantTile name={t.aiInterview.you} level={level} muted={false} />
          </div>
          {/* Always say something: either it hears the candidate, or how to test it. */}
          <p role="status" className={`text-callout ${hearing ? 'text-[#5fd07a]' : 'text-[#cfc8ea]'}`}>
            {blocked ? '' : hearing ? t.aiInterview.lobbyMicWorking : t.aiInterview.lobbySpeakToTest}
          </p>
        </div>

        {blocked && (
          <div role="alert" className="w-full rounded-lg bg-[#3a1414] p-3 text-callout text-[#ff8a8f]">
            <p className="font-medium">{t.aiInterview.lobbyMicDenied}</p>
            <p className="mt-1">{t.aiInterview.lobbyMicDeniedHelp}</p>
          </div>
        )}

        {error && (
          <div role="alert" className="w-full rounded-lg bg-[#3a1414] p-3 text-callout text-[#ff8a8f]">
            {error}
          </div>
        )}

        {/* White on the dark card: 16:1, where the old violet button with white text was 4.35:1. */}
        <Button variant="secondary" size="lg" fullWidth onClick={onJoin} loading={joining} loadingLabel={t.aiInterview.connecting}>
          {t.aiInterview.lobbyJoin}
        </Button>
      </div>
    </main>
  );
}
