'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CONSENT_WITHDRAWAL_CHANNELS, CONSENT_WITHDRAWAL_REASON_MAX } from '@tims/shared';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Modal } from '../../../../../components';
import { classifyConsentError, useWithdrawCandidateConsent } from '../../../../../lib/platform-api/candidate-consent';
import { consentChannelLabel } from './consent-labels';

const FIELD_CLS =
  'w-full rounded-lg border border-[#EDEDED] bg-white px-3 text-[13px] focus:border-[#1F114C] focus:outline-none';

// #312 — staff record a withdrawal the organization received outside the portal (email, phone, letter...).
export function ConsentWithdrawModal({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.candidateConsent;

  const schema = useMemo(
    () =>
      z.object({
        channel: z.enum(CONSENT_WITHDRAWAL_CHANNELS, { errorMap: () => ({ message: m.channelRequired }) }),
        reason: z.string().trim().max(CONSENT_WITHDRAWAL_REASON_MAX, m.reasonTooLong),
        requestDeletion: z.boolean(),
      }),
    [m.channelRequired, m.reasonTooLong],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { channel: undefined, reason: '', requestDeletion: false },
  });
  const { errors } = form.formState;

  const withdraw = useWithdrawCandidateConsent(candidateId, {
    onSuccess: () => {
      toast(m.success, { type: 'success' });
      onClose();
    },
    onError: (error) => {
      const kind = classifyConsentError(error);
      toast(kind === 'forbidden' ? m.errorForbidden : kind === 'not_found' ? m.errorNotFound : m.errorGeneric, {
        type: 'error',
      });
    },
  });

  return (
    <Modal title={m.modalTitle} onClose={onClose}>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) =>
          withdraw.mutate({
            channel: values.channel,
            reason: values.reason || undefined,
            requestDeletion: values.requestDeletion,
          }),
        )}
        className="space-y-4"
      >
        <p className="text-[13px] text-[#585858]">{m.modalDesc}</p>

        <div>
          <label htmlFor="consent-withdraw-channel" className="mb-1.5 block text-[12px] font-medium text-[#585858]">
            {m.channelLabel}
          </label>
          <select id="consent-withdraw-channel" className={`${FIELD_CLS} h-9`} {...form.register('channel')}>
            <option value="">—</option>
            {CONSENT_WITHDRAWAL_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {consentChannelLabel(channel, m)}
              </option>
            ))}
          </select>
          {errors.channel && <p className="mt-1 text-[11px] text-red-600">{errors.channel.message}</p>}
        </div>

        <div>
          <label htmlFor="consent-withdraw-reason" className="mb-1.5 block text-[12px] font-medium text-[#585858]">
            {m.reasonLabel}
          </label>
          <textarea
            id="consent-withdraw-reason"
            rows={3}
            maxLength={CONSENT_WITHDRAWAL_REASON_MAX}
            placeholder={m.reasonPlaceholder}
            className={`${FIELD_CLS} py-2`}
            {...form.register('reason')}
          />
          {errors.reason && <p className="mt-1 text-[11px] text-red-600">{errors.reason.message}</p>}
        </div>

        <label className="flex items-start gap-2 text-[13px] text-[#333]">
          <input type="checkbox" className="mt-0.5 h-4 w-4" {...form.register('requestDeletion')} />
          {m.requestDeletionLabel}
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-lg border border-[#EDEDED] px-4 text-[13px] text-[#585858] hover:bg-[#F6F6F6]"
          >
            {m.cancel}
          </button>
          <button
            type="submit"
            disabled={withdraw.isPending}
            className="h-9 rounded-lg bg-[#DD0C15] px-4 text-[13px] font-semibold text-white hover:bg-[#b80a12] disabled:opacity-50"
          >
            {withdraw.isPending ? m.submitting : m.submit}
          </button>
        </div>
      </form>
    </Modal>
  );
}
