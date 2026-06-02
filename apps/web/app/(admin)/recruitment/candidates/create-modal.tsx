'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

interface CreateModalProps {
  onConfirm: (data: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
    source: string;
    poolType: string;
    location?: string;
    currentTitle?: string;
    currentCompany?: string;
    linkedinUrl?: string;
  }) => void;
  onClose: () => void;
  isPending: boolean;
}

export function CreateModal({ onConfirm, onClose, isPending }: CreateModalProps) {
  const { t } = useI18n();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [source, setSource] = useState('manual');
  const [poolType, setPoolType] = useState('applicant');
  const [location, setLocation] = useState('');
  const [currentTitle, setCurrentTitle] = useState('');
  const [currentCompany, setCurrentCompany] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');

  const handleSubmit = () => {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) return;
    onConfirm({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      source,
      poolType,
      location: location.trim() || undefined,
      currentTitle: currentTitle.trim() || undefined,
      currentCompany: currentCompany.trim() || undefined,
      linkedinUrl: linkedinUrl.trim() || undefined,
    });
  };

  return (
    <Modal title={t.candidates.createTitle} onClose={onClose} maxWidth="max-w-xl">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.firstName} *</label>
            <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={120} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.lastName} *</label>
            <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.email} *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.phone}</label>
            <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.source}</label>
            <select value={source} onChange={(e) => setSource(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="manual">{t.candidates.sourceManual}</option>
              <option value="linkedin">{t.candidates.sourceLinkedin}</option>
              <option value="portal">{t.candidates.sourcePortal}</option>
              <option value="referral">{t.candidates.sourceReferral}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.poolType}</label>
            <select value={poolType} onChange={(e) => setPoolType(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="applicant">{t.candidates.poolApplicant}</option>
              <option value="referral">{t.candidates.poolReferral}</option>
              <option value="sourced">{t.candidates.poolSourced}</option>
              <option value="passive">{t.candidates.poolPassive}</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.currentTitle}</label>
            <input type="text" value={currentTitle} onChange={(e) => setCurrentTitle(e.target.value)} placeholder="Software Engineer" maxLength={200} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.currentCompany}</label>
            <input type="text" value={currentCompany} onChange={(e) => setCurrentCompany(e.target.value)} placeholder="Acme Corp" maxLength={200} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.location}</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Bogota, Colombia" maxLength={200} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#585858] mb-1">{t.candidates.linkedinUrl}</label>
            <input type="url" value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.target.value)} placeholder="https://linkedin.com/in/..." maxLength={2048} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
          {t.common.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={!firstName.trim() || !lastName.trim() || !email.trim() || isPending}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {isPending ? t.common.saving : t.common.create}
        </button>
      </div>
    </Modal>
  );
}
