'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface CreateModalProps {
  onConfirm: (data: {
    title: string;
    description?: string;
    positions: number;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    contractType?: string;
    location?: string;
    remotePolicy?: 'onsite' | 'remote' | 'hybrid';
  }) => void;
  onClose: () => void;
  isPending: boolean;
}

export function CreateModal({ onConfirm, onClose, isPending }: CreateModalProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [positions, setPositions] = useState(1);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [contractType, setContractType] = useState('');
  const [location, setLocation] = useState('');
  const [remotePolicy, setRemotePolicy] = useState<'onsite' | 'remote' | 'hybrid' | ''>('');

  const handleSubmit = () => {
    if (!title.trim()) return;
    onConfirm({
      title: title.trim(),
      description: description.trim() || undefined,
      positions,
      priority,
      contractType: contractType.trim() || undefined,
      location: location.trim() || undefined,
      remotePolicy: remotePolicy || undefined,
    });
  };

  return (
    <Modal title={t.vacancies.createTitle} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.titleLabel} *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t.vacancies.titlePlaceholder}
            maxLength={200}
            className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.description}</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.vacancies.descriptionPlaceholder}
            maxLength={5000}
            rows={3}
            className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.positions}</label>
            <input
              type="number"
              value={positions}
              onChange={(e) => setPositions(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
              min={1}
              max={100}
              className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.priority}</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as typeof priority)}
              className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            >
              <option value="low">{t.vacancies.priorityLow}</option>
              <option value="medium">{t.vacancies.priorityMedium}</option>
              <option value="high">{t.vacancies.priorityHigh}</option>
              <option value="urgent">{t.vacancies.priorityUrgent}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.contractType}</label>
            <input
              type="text"
              value={contractType}
              onChange={(e) => setContractType(e.target.value)}
              placeholder="Indefinido"
              maxLength={100}
              className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.location}</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Bogota, Colombia"
              maxLength={200}
              className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.vacancies.remote}</label>
            <select
              value={remotePolicy}
              onChange={(e) => setRemotePolicy(e.target.value as typeof remotePolicy)}
              className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
            >
              <option value="">—</option>
              <option value="onsite">{t.vacancies.onsite}</option>
              <option value="hybrid">{t.vacancies.hybrid}</option>
              <option value="remote">{t.vacancies.remote}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
          {t.common.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!title.trim() || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.common.create}
        </button>
      </div>
    </Modal>
  );
}
