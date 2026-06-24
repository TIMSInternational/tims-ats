'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { AiScreenResult } from './[id]/ai-screen-result';

// ---------------------------------------------------------------------------
// AI Voice Interview — recruiter entry point (Task 8).
// Calls aiInterview.create for the interview, surfaces the candidate magic-link
// in a copyable field, and — once a session exists — renders the result panel
// (AiScreenResult) inline using the returned sessionId.
// aiInterview.create is a budget-spending mutation, so it only fires on the
// explicit "Start AI screen" button press, never on mount.
// ---------------------------------------------------------------------------

interface AiScreenModalProps {
  interviewId: string;
  onClose: () => void;
}

export function AiScreenModal({ interviewId, onClose }: AiScreenModalProps) {
  const { t } = useI18n();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [candidateLink, setCandidateLink] = useState<string | null>(null);

  const create = trpc.aiInterview.create.useMutation({
    onSuccess: (data) => {
      setSessionId(data.sessionId);
      setCandidateLink(data.candidateLink);
      toast(t.interviews.aiScreenCreated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const copyLink = async () => {
    if (!candidateLink) return;
    try {
      await navigator.clipboard.writeText(candidateLink);
      toast(t.interviews.linkCopied, { type: 'success' });
    } catch {
      toast(t.interviews.copyLinkError, { type: 'error' });
    }
  };

  return (
    <Modal title={t.interviews.aiScreenTitle} onClose={onClose}>
      {!candidateLink ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => create.mutate({ interviewId })}
            disabled={create.isPending}
            className="w-full flex items-center justify-center gap-2 bg-[#1F114C] text-white py-2.5 rounded-lg text-[12px] font-medium hover:bg-[#2a1866] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {create.isPending && (
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {t.interviews.startAiScreen}
          </button>
          {create.isError && (
            <p className="text-[11px] text-[#DD0C15]">{create.error.message}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-[#585858] mb-1">
              {t.interviews.candidateLinkLabel}
            </label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={candidateLink}
                className="flex-1 h-9 px-3 rounded-lg border border-[#EDEDED] bg-[#FAFAFA] text-[11px] text-[#333]"
              />
              <button
                type="button"
                onClick={copyLink}
                className="h-9 px-3 rounded-lg text-[11px] font-medium text-white bg-[#1F114C] hover:bg-[#2a1866] transition-colors shrink-0"
              >
                {t.interviews.copyLink}
              </button>
            </div>
          </div>

          {sessionId && (
            <div className="border-t border-[#EDEDED] pt-4">
              <AiScreenResult sessionId={sessionId} />
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end mt-5">
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
        >
          {t.common.close}
        </button>
      </div>
    </Modal>
  );
}
