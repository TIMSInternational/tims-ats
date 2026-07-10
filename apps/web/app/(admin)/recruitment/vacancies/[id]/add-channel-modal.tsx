'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Modal } from '../../../../../components';

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
    <Modal title={t.vacancies.addChannelTitle} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.channelNameLabel} *</label>
          <input
            type="text"
            value={channelName}
            onChange={(e) => setChannelName(e.target.value)}
            placeholder={t.vacancies.channelNamePlaceholder}
            maxLength={100}
            className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.channelTypeLabel}</label>
          <select
            value={channelType}
            onChange={(e) => setChannelType(e.target.value as ChannelType)}
            className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
          >
            {CHANNEL_TYPES.map((ct) => (
              <option key={ct} value={ct}>{typeLabel[ct]}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
          {t.common.cancel}
        </button>
        <button
          onClick={() => onConfirm(channelName, channelType)}
          disabled={!channelName.trim() || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.vacancies.addChannel}
        </button>
      </div>
    </Modal>
  );
}
