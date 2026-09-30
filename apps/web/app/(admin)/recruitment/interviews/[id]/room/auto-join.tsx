'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useDaily, useDailyEvent, useMeetingState } from '@daily-co/daily-react';
import { classifyDailyJoinError, type DailyJoinErrorCategory } from './daily-join-error';

interface AutoJoinProps {
  url: string;
  token: string;
  /** Called once per attempt when the join fails or the call hits a fatal error. */
  onError: (category: DailyJoinErrorCategory) => void;
}

/**
 * Joins the Daily call once the call object is ready. Must be rendered inside
 * DailyProvider. Exactly ONE join per mount: a failure is reported through
 * `onError` and never retried automatically (a blocked bundle or an expired
 * token would fail forever) — the parent remounts this with a fresh token when
 * the user asks to retry.
 */
export function AutoJoin({ url, token, onError }: AutoJoinProps) {
  const daily = useDaily();
  const meetingState = useMeetingState();
  const hasTriedJoin = useRef(false);
  const hasReported = useRef(false);

  const report = useCallback(
    (err: unknown) => {
      if (hasReported.current) return;
      hasReported.current = true;
      onError(classifyDailyJoinError(err));
    },
    [onError],
  );

  useDailyEvent('error', report);

  useEffect(() => {
    if (!daily || hasTriedJoin.current) return;
    if (meetingState !== 'new' && meetingState !== 'loaded') return;

    hasTriedJoin.current = true;
    daily.join({ url, token }).catch(report);
  }, [daily, meetingState, url, token, report]);

  return null;
}
