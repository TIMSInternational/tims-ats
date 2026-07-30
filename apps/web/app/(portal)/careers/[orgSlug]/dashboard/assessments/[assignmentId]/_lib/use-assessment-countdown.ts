'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface UseAssessmentCountdownArgs {
  startedAt: Date;
  expiresAt: Date | null;
  durationMinutes: number | null;
  onExpire: () => void;
}

// Both cutoffs matter: an assignment's expiresAt (an absolute deadline set at
// assignment time) can be TIGHTER than what durationMinutes alone would suggest.
// If durationMinutes is null, no timer renders at all (untimed assessment type) —
// expiresAt alone never drives a visible countdown in that case.
export function useAssessmentCountdown({
  startedAt,
  expiresAt,
  durationMinutes,
  onExpire,
}: UseAssessmentCountdownArgs): number | null {
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const firedRef = useRef(false);

  const deadline = useMemo(() => {
    if (durationMinutes === null) return null;
    const durationDeadline = new Date(startedAt.getTime() + durationMinutes * 60_000);
    if (expiresAt !== null && expiresAt.getTime() < durationDeadline.getTime()) return expiresAt;
    return durationDeadline;
  }, [startedAt, expiresAt, durationMinutes]);

  const computeRemaining = useCallback(() => {
    if (deadline === null) return null;
    return Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000));
  }, [deadline]);

  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(computeRemaining);

  useEffect(() => {
    firedRef.current = false;
    setRemainingSeconds(computeRemaining());
    if (deadline === null) return;
    const interval = setInterval(() => {
      const remaining = computeRemaining();
      setRemainingSeconds(remaining);
      if (remaining !== null && remaining <= 0 && !firedRef.current) {
        firedRef.current = true;
        onExpireRef.current();
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [deadline, computeRemaining]);

  return remainingSeconds;
}
