'use client';

import { useEffect, type MutableRefObject } from 'react';
import { useDaily, useMeetingState } from '@daily-co/daily-react';

interface CallStateBridgeProps {
  onCallActiveChange: (isActive: boolean) => void;
  /** Receives a function that leaves the call, while a call object exists. */
  leaveRef: MutableRefObject<(() => void) | null>;
}

/**
 * DailyProvider wraps only the room's video stage, so the scorecard beside it
 * never remounts when the evaluator joins or leaves the call (a remount would
 * discard the unsaved scorecard draft). This bridge, rendered inside the
 * provider, reports the call state to the top bar, which lives outside it.
 */
export function CallStateBridge({ onCallActiveChange, leaveRef }: CallStateBridgeProps) {
  const daily = useDaily();
  const meetingState = useMeetingState();

  useEffect(() => {
    onCallActiveChange(meetingState === 'joined-meeting');
  }, [meetingState, onCallActiveChange]);

  useEffect(() => () => onCallActiveChange(false), [onCallActiveChange]);

  useEffect(() => {
    leaveRef.current = daily
      ? () => {
          void daily.leave();
        }
      : null;
    return () => {
      leaveRef.current = null;
    };
  }, [daily, leaveRef]);

  return null;
}
