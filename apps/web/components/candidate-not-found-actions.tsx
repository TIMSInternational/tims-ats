'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '../lib/i18n';
import { candidatePortalHref } from '../lib/careers-not-found';
import { Button } from './button';

interface CandidateNotFoundActionsProps {
  /** The organization's job board when the missing page sits below one; null when the board itself is missing. */
  boardHref: string | null;
}

/**
 * The way out of a candidate-facing 404 (shown when NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED is 'true').
 * Below a board: back to its vacancies, plus the candidate portal. With no board there is no careers home to
 * link to, so the one honest action is going back to where the visitor came from, offered only when the tab
 * has a previous page (a link opened in a new tab or an in-app browser has none).
 */
export function CandidateNotFoundActions({ boardHref }: CandidateNotFoundActionsProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  // window.history is only readable after mount; reading it during render would not match the server HTML.
  useEffect(() => {
    setCanGoBack(window.history.length > 1);
  }, []);

  if (boardHref) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row">
        <Button href={boardHref} size="lg">
          {t.notFound.backToVacancies}
        </Button>
        <Button href={candidatePortalHref(boardHref)} size="lg" variant="secondary">
          {t.notFound.candidatePortal}
        </Button>
      </div>
    );
  }

  if (!canGoBack) return null;
  return (
    <Button size="lg" variant="secondary" className="mt-6" onClick={() => router.back()}>
      {t.notFound.goBack}
    </Button>
  );
}
