'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button, Field, Modal, Select, TextInput } from '../../../../../components';

const CHANNEL_TYPES = ['internal', 'linkedin', 'indeed', 'computrabajo', 'elempleo', 'website', 'other'] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

interface AddChannelModalProps {
  onConfirm: (channelName: string, channelType: ChannelType) => void;
  onClose: () => void;
  isPending: boolean;
}

export function AddChannelModal({ onConfirm, onClose, isPending }: AddChannelModalProps) {
  const { t } = useI18n();
  const [channelName, setChannelName] = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('internal');

  const typeLabel: Record<ChannelType, string> = {
    internal: t.vacancies.channelTypeInternal,
    linkedin: t.vacancies.channelTypeLinkedin,
    indeed: t.vacancies.channelTypeIndeed,
    computrabajo: t.vacancies.channelTypeComputrabajo,
    elempleo: t.vacancies.channelTypeElempleo,
    website: t.vacancies.channelTypeWebsite,
    other: t.vacancies.channelTypeOther,
  };

  return (
    <Modal
      title={t.vacancies.addChannelTitle}
      onClose={onClose}
      dirty={channelName.trim().length > 0 && !isPending}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button
            onClick={() => onConfirm(channelName, channelType)}
            disabled={!channelName.trim()}
            loading={isPending}
            loadingLabel={t.vacancies.addingChannel}
          >
            {t.vacancies.addChannel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t.vacancies.channelNameLabel} required>
          <TextInput
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder={t.vacancies.channelNamePlaceholder}
            maxLength={100}
            autoFocus
          />
        </Field>
        <Field label={t.vacancies.channelTypeLabel}>
          <Select value={channelType} onChange={(e) => setChannelType(e.target.value as ChannelType)}>
            {CHANNEL_TYPES.map((ct) => (
              <option key={ct} value={ct}>
                {typeLabel[ct]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
