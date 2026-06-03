'use client';

import { useEffect, useRef } from 'react';
import { useDaily, useMeetingState } from '@daily-co/daily-react';

/**
 * Auto-joins the Daily call once the call object is ready.
 * Must be rendered inside DailyProvider.
 */
export function AutoJoin({ url, token }: { url: string; token: string }) {
  const daily = useDaily();
  const meetingState = useMeetingState();
  const hasTriedJoin = useRef(false);

  useEffect(() => {
    if (!daily || hasTriedJoin.current) return;
    if (meetingState !== 'new' && meetingState !== 'loaded') return;

    hasTriedJoin.current = true;
    daily.join({ url, token }).catch((err) => {
      console.error('Failed to join Daily call:', err);
      hasTriedJoin.current = false;
    });
  }, [daily, meetingState, url, token]);

  return null;
}
