'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CONSENT_WITHDRAWAL_CHANNELS, CONSENT_WITHDRAWAL_REASON_MAX } from '@tims/shared';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  CHOICE_INPUT_CLASSES,
  Field,
  Modal,
  Select,
  TextArea,
} from '../../../../../components';
import { classifyConsentError, useWithdrawCandidateConsent } from '../../../../../lib/platform-api/candidate-consent';
import { consentChannelLabel } from './consent-labels';

// #312 — staff record a withdrawal the organization received outside the portal (email, phone, letter...).
export function ConsentWithdrawModal({ candidateId, onClose }: { candidateId: string; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.candidateConsent;

  const schema = useMemo(
    () =>
      z.object({
        channel: z.enum(CONSENT_WITHDRAWAL_CHANNELS, { error: m.channelRequired }),
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
  const [serverError, setServerError] = useState<string | null>(null);

  const withdraw = useWithdrawCandidateConsent(candidateId, {
    onSuccess: () => {
      toast(m.success, { type: 'success' });
      onClose();
    },
    // The dialog stays open on failure, so the message shows in it (role="alert") instead of only in a toast.
    onError: (error) => {
      const kind = classifyConsentError(error);
      setServerError(kind === 'forbidden' ? m.errorForbidden : kind === 'not_found' ? m.errorNotFound : m.errorGeneric);
    },
  });

  return (
    <Modal title={m.modalTitle} onClose={onClose}>
      <form
        noValidate
        onSubmit={form.handleSubmit((values) => {
          setServerError(null);
          withdraw.mutate({
            channel: values.channel,
            reason: values.reason || undefined,
            requestDeletion: values.requestDeletion,
          });
        })}
        className="space-y-4"
      >
        <p className="text-body text-secondary">{m.modalDesc}</p>

        <Field label={m.channelLabel} id="consent-withdraw-channel" required error={errors.channel?.message}>
          {(control) => (
            <Select {...control} {...form.register('channel')}>
              <option value="">{m.channelPlaceholder}</option>
              {CONSENT_WITHDRAWAL_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {consentChannelLabel(channel, m)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label={m.reasonLabel} id="consent-withdraw-reason" optional error={errors.reason?.message}>
          {(control) => (
            <TextArea
              {...control}
              rows={3}
              maxLength={CONSENT_WITHDRAWAL_REASON_MAX}
              placeholder={m.reasonPlaceholder}
              {...form.register('reason')}
            />
          )}
        </Field>

        <label className="flex items-start gap-2 text-body text-primary pointer-coarse:min-h-11">
          <input type="checkbox" className={`${CHOICE_INPUT_CLASSES} mt-0.5`} {...form.register('requestDeletion')} />
          {m.requestDeletionLabel}
        </label>

        {serverError && (
          <p role="alert" className="text-callout text-danger">
            {serverError}
          </p>
        )}

        <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
          <Button variant="secondary" onClick={onClose}>
            {m.cancel}
          </Button>
          <Button type="submit" variant="destructive" loading={withdraw.isPending} loadingLabel={m.submitting}>
            {m.submit}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
