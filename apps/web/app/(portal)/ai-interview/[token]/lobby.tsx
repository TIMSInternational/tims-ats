'use client';

import { useI18n } from '../../../../lib/i18n';
import { useMicLevel } from './use-mic-level';
import { ParticipantTile } from './participant-tile';

interface LobbyProps {
  onJoin: () => void;
  joining: boolean;
  error: string | null;
}

export function Lobby({ onJoin, joining, error }: LobbyProps) {
  const { t } = useI18n();
  const level = useMicLevel(true);

  return (
    <div className="min-h-screen bg-[#0E0A1F] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-[#160f2e] p-8 flex flex-col items-center gap-6">
        <h1 className="text-lg font-semibold text-white">{t.aiInterview.lobbyHeading}</h1>

        <div className="w-full flex flex-col items-center gap-2">
          <p className="text-[11px] uppercase tracking-wide text-[#8a83ad]">
            {t.aiInterview.lobbyMicCheck}
          </p>
          <div className="w-40">
            <ParticipantTile name={t.aiInterview.you} level={level} muted={false} />
          </div>
          {level > 0.05 && <p className="text-xs text-[#5fd07a]">{t.aiInterview.lobbyMicWorking}</p>}
        </div>

        {error && (
          <div className="w-full text-xs text-[#ff8a8f] bg-[#3a1414] px-3 py-2 rounded-lg">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={onJoin}
          disabled={joining}
          className="w-full h-12 rounded-xl bg-[#7c5cff] text-white text-sm font-semibold hover:bg-[#6b4ce0] transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {joining ? t.aiInterview.loading : t.aiInterview.lobbyJoin}
        </button>
      </div>
    </div>
  );
}
