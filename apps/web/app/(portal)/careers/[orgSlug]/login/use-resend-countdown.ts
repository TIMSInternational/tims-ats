'use client';

import { useCallback, useEffect, useState } from 'react';
import { secondsUntil } from '../../../../../lib/portal-auth';

// Seconds until the candidate may ask for another sign-in email. `start(n)` (re)starts the wait; the
// interval runs only while a wait is pending.
export function useResendCountdown(): { secondsLeft: number; start: (seconds: number) => void } {
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === 0) return;
    const id = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= deadline) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);

  const start = useCallback((seconds: number) => {
    const current = Date.now();
    setNow(current);
    setDeadline(current + seconds * 1000);
  }, []);

  return { secondsLeft: secondsUntil(deadline, now), start };
}
