'use client';

import { useState } from 'react';
import { timeZoneLabel, zonedWallTimeToDate } from '@tims/shared';
import { Modal } from '../../../../components';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { DURATIONS } from './schedule-modal.helpers';
import { Button } from '../../../../components/button';
import { FIELD_ERROR_CLASSES, FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES, inputClasses, selectClasses } from '../../../../components/field-styles';
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
    <Modal
      title={t.interviews.rescheduleDialogTitle}
      description={t.interviews.rescheduleDialogBody}
      onClose={onClose}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.interviews.rescheduleKeep}
          </Button>
          <Button
            disabled={!isFuture}
            loading={reschedule.isPending}
            onClick={() => scheduledAt && reschedule.mutate({ id: target.id, scheduledAt, duration })}
          >
            {t.interviews.rescheduleConfirm}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="reschedule-date" className={FIELD_LABEL_CLASSES}>{t.interviews.rescheduleDateLabel}</label>
          <input id="reschedule-date" type="date" value={dateValue} onChange={(e) => setDate(e.target.value)} className={inputClasses()} aria-describedby="reschedule-zone" />
        </div>
        <div>
          <label htmlFor="reschedule-time" className={FIELD_LABEL_CLASSES}>{t.interviews.rescheduleTimeLabel}</label>
          <input id="reschedule-time" type="time" value={timeValue} onChange={(e) => setTime(e.target.value)} className={inputClasses()} aria-describedby="reschedule-zone" />
        </div>
      </div>
      <p id="reschedule-zone" className={FIELD_HELP_CLASSES}>{zoneLabel}</p>
      <label htmlFor="reschedule-duration" className={`${FIELD_LABEL_CLASSES} mt-4`}>{t.interviews.rescheduleDurationLabel}</label>
      <select id="reschedule-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={selectClasses()}>
        {DURATIONS.map((d) => <option key={d.value} value={d.value}>{t.interviews[d.labelKey]}</option>)}
      </select>
      {scheduledAt !== null && !isFuture && (
        <p role="alert" className={FIELD_ERROR_CLASSES}>{t.interviews.reschedulePast}</p>
      )}
    </Modal>
  );
}
