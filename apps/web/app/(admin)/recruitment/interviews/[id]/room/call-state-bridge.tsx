'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import { useDaily, useMeetingState } from '@daily-co/daily-react';

type DailyCall = NonNullable<ReturnType<typeof useDaily>>;

interface CallStateBridgeProps {
  onCallActiveChange: (isActive: boolean) => void;
  /** Receives a function that leaves the call, while a call object exists. */
  leaveRef: MutableRefObject<(() => void) | null>;
}

/** Idempotent: safe after JoinErrorPanel or a previous unmount already destroyed it. */
function destroyQuietly(call: DailyCall): void {
  try {
    if (!call.isDestroyed()) void call.destroy().catch(() => undefined);
  } catch {
    // A call object that throws while being torn down is already unusable.
  }
}

/**
 * DailyProvider wraps only the room's video stage, so the scorecard beside it
 * never remounts when the evaluator joins or leaves the call (a remount would
 * discard the unsaved scorecard draft). This bridge, rendered inside the
 * provider:
 * - reports the call state to the top bar, which lives outside the provider;
 * - DESTROYS the call object when the video stage unmounts. daily-react 0.25.2's
 *   DailyProvider has no unmount cleanup, so without this, leaving the stage
 *   would keep the evaluator live on camera and microphone.
 */
export function CallStateBridge({ onCallActiveChange, leaveRef }: CallStateBridgeProps) {
  const daily = useDaily();
  const meetingState = useMeetingState();
  // The destroy is deferred one tick so React StrictMode's simulated
  // unmount/remount (dev only) does not kill a live call; a real unmount runs it.
  const pendingDestroy = useRef<{ call: DailyCall; timer: ReturnType<typeof setTimeout> } | null>(null);

  useEffect(() => {
    onCallActiveChange(meetingState === 'joined-meeting');
  }, [meetingState, onCallActiveChange]);

  useEffect(() => () => onCallActiveChange(false), [onCallActiveChange]);

  useEffect(() => {
    if (pendingDestroy.current && pendingDestroy.current.call === daily) {
      clearTimeout(pendingDestroy.current.timer);
      pendingDestroy.current = null;
    }
    leaveRef.current = daily
      ? () => {
          void daily.leave().catch(() => undefined);
        }
      : null;
    return () => {
      leaveRef.current = null;
      if (!daily) return;
      const timer = setTimeout(() => {
        if (pendingDestroy.current?.call === daily) pendingDestroy.current = null;
        destroyQuietly(daily);
      }, 0);
      pendingDestroy.current = { call: daily, timer };
    };
  }, [daily, leaveRef]);

  return null;
}
