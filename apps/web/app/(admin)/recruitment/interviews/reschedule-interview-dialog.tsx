'use client';

import { useState } from 'react';
import { timeZoneLabel, zonedWallTimeToDate } from '@tims/shared';
import { Modal } from '../../../../components';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { DURATIONS, inputCls, labelCls } from './schedule-modal.helpers';
import { rescheduleErrorMessage, wallTimeInZone } from './interview-reschedule';

export interface RescheduleTarget {
  id: string;
  vacancyId: string;
  scheduledAt: Date | string;
  duration: number;
}

// "Reprogramar" (recruiter-journeys-28). The typed time means the same zone the invitation emails print (the
// organization's, then the vacancy company's, then UTC), read the way the schedule modal reads it. The server
// re-sends the updated invitation (.ics) to the candidate and the panel and revokes the old join link.
export function RescheduleInterviewDialog({
  target,
  onClose,
  onDone,
}: {
  target: RescheduleTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const zoneQuery = trpc.interview.list.useQuery({ vacancyId: target.vacancyId, pageSize: 1 }, { staleTime: 5 * 60_000 });
  const timeZone = zoneQuery.data?.schedulingTimeZone?.timeZone ?? null;
  const initial = timeZone ? wallTimeInZone(target.scheduledAt, timeZone) : null;
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [duration, setDuration] = useState(target.duration);
  const dateValue = date ?? initial?.date ?? '';
  const timeValue = time ?? initial?.time ?? '';
  const scheduledAt = timeZone ? zonedWallTimeToDate(dateValue, timeValue, timeZone) : null;
  const isFuture = scheduledAt !== null && scheduledAt.getTime() > Date.now();
  const zoneLabel = timeZone
    ? timeZoneLabel(timeZone, locale === 'EN' ? 'en' : 'es', scheduledAt ?? new Date())
    : zoneQuery.isError
      ? t.common.error
      : t.common.loading;

  const reschedule = trpc.interview.reschedule.useMutation({
    onSuccess: () => {
      toast(t.interviews.rescheduledToast, { type: 'success' });
      onDone();
    },
    onError: (err) => toast(rescheduleErrorMessage(err, t.interviews), { type: 'error' }),
  });

  return (
    <Modal title={t.interviews.rescheduleDialogTitle} onClose={onClose} maxWidth="max-w-md">
      <p className="text-sm text-[#585858] mb-4">{t.interviews.rescheduleDialogBody}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="reschedule-date" className={labelCls}>{t.interviews.rescheduleDateLabel}</label>
          <input id="reschedule-date" type="date" value={dateValue} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label htmlFor="reschedule-time" className={labelCls}>{t.interviews.rescheduleTimeLabel}</label>
          <input id="reschedule-time" type="time" value={timeValue} onChange={(e) => setTime(e.target.value)} className={inputCls} />
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[#8B8B8B]">{zoneLabel}</p>
      <label htmlFor="reschedule-duration" className={`${labelCls} mt-3`}>{t.interviews.rescheduleDurationLabel}</label>
      <select id="reschedule-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={`${inputCls} bg-white`}>
        {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
      </select>
      {scheduledAt !== null && !isFuture && (
        <p role="alert" className="mt-3 text-[12px] text-red-700">{t.interviews.reschedulePast}</p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
          {t.interviews.rescheduleKeep}
        </button>
        <button
          type="button"
          disabled={!isFuture || reschedule.isPending}
          onClick={() => scheduledAt && reschedule.mutate({ id: target.id, scheduledAt, duration })}
          className="h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1863] transition disabled:opacity-50"
        >
          {t.interviews.rescheduleConfirm}
        </button>
      </div>
    </Modal>
  );
}
