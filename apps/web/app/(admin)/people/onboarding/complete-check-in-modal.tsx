'use client';

import { useState } from 'react';
import { Button, BUTTON_GROUP_CLASSES, Field, Modal, Select, TextArea } from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { trpc } from '../../../../lib/trpc';

export function CompleteCheckInModal({ id, label, onClose }: { id: string; label: string; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [notes, setNotes] = useState('');
  const [score, setScore] = useState('');
  const complete = trpc.onboarding.completeCheckIn.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.onboarding.list.invalidate(), utils.onboarding.getDashboardKpis.invalidate()]);
      toast(t.onboarding.checkInCompleted, { type: 'success' });
      onClose();
    },
    onError: (error) => toast(error.message, { type: 'error' }),
  });

  return (
    <Modal title={t.onboarding.completeCheckInTitle} description={label} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          complete.mutate({ id, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(score ? { score: Number(score) } : {}) });
        }}
      >
        <Field label={t.onboarding.checkInNotes}>
          <TextArea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={20000}
            rows={3}
            disabled={complete.isPending}
          />
        </Field>
        <Field label={t.onboarding.checkInScore}>
          <Select value={score} onChange={(event) => setScore(event.target.value)} disabled={complete.isPending}>
            <option value="">—</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </Field>
        <div className={BUTTON_GROUP_CLASSES}>
          <Button variant="secondary" onClick={onClose} disabled={complete.isPending}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={complete.isPending} loading={complete.isPending} loadingLabel={t.common.saving}>
            {t.onboarding.completeCheckInTitle}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
