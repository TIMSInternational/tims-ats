'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useReportCandidateProctoringEvent,
  type CandidateProctoringSignal,
} from '../../../../../../../../lib/platform-api/proctoring';

type PendingEvent = { eventId: string; type: CandidateProctoringSignal; clientTimestamp: string };

const SIGNAL_COOLDOWN_MS = 30_000;
const MAX_PENDING_EVENTS = 50;

export function useProctoringEventQueue(orgSlug: string, assignmentId: string) {
  const [syncError, setSyncError] = useState(false);
  const pendingRef = useRef<PendingEvent[]>([]);
  const lastSignalRef = useRef(new Map<CandidateProctoringSignal, number>());
  const inFlightRef = useRef<Promise<void> | null>(null);
  const report = useReportCandidateProctoringEvent();
  const reportMutateRef = useRef(report.mutateAsync);

  useEffect(() => {
    reportMutateRef.current = report.mutateAsync;
  }, [report.mutateAsync]);

  const flush = useCallback((): Promise<void> => {
    // A submit must wait for an event already being sent as well as those queued.
    if (inFlightRef.current) return inFlightRef.current;
    if (!navigator.onLine) {
      setSyncError(true);
      return Promise.resolve();
    }
    const work = (async () => {
      try {
        while (pendingRef.current.length > 0) {
          const next = pendingRef.current[0];
          await reportMutateRef.current({ orgSlug, assignmentId, ...next });
          pendingRef.current.shift();
        }
        setSyncError(false);
      } catch {
        // Keep the same event ID for a later retry. A failed browser event is
        // never presented as proof that monitoring continued uninterrupted.
        setSyncError(true);
      }
    })();
    const settled = work.finally(() => {
      inFlightRef.current = null;
    });
    inFlightRef.current = settled;
    return settled;
  }, [assignmentId, orgSlug]);

  const enqueue = useCallback(
    (type: CandidateProctoringSignal) => {
      const now = Date.now();
      if (now - (lastSignalRef.current.get(type) ?? 0) < SIGNAL_COOLDOWN_MS) return;
      if (pendingRef.current.length >= MAX_PENDING_EVENTS || !globalThis.crypto?.randomUUID) {
        setSyncError(true);
        return;
      }
      lastSignalRef.current.set(type, now);
      pendingRef.current.push({
        eventId: globalThis.crypto.randomUUID(),
        type,
        clientTimestamp: new Date(now).toISOString(),
      });
      void flush();
    },
    [flush],
  );

  return { enqueue, flush, syncError };
}
