'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { Button } from '../../../../components/button';
import { FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES, inputClasses } from '../../../../components/field-styles';
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
    <Modal
      title={t.interviews.aiScreenTitle}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          {t.common.close}
        </Button>
      }
    >
      {!candidateLink ? (
        <div className="space-y-4">
          <Button fullWidth loading={create.isPending} onClick={() => create.mutate({ interviewId })}>
            {t.interviews.startAiScreen}
          </Button>
          {create.isError && (
            <p role="alert" className={FIELD_ERROR_CLASSES}>{create.error.message}</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label htmlFor="ai-screen-link" className={FIELD_LABEL_CLASSES}>
              {t.interviews.candidateLinkLabel}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="ai-screen-link"
                readOnly
                value={candidateLink}
                className={inputClasses('md', 'flex-1 bg-surface-hover')}
              />
              <Button variant="secondary" className="shrink-0" onClick={copyLink}>
                {t.interviews.copyLink}
              </Button>
            </div>
          </div>

          {sessionId && (
            <div className="border-t border-border pt-4">
              <AiScreenResult sessionId={sessionId} />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
