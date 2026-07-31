'use client';

import { CvUploadField } from './cv-upload-field';
import { useI18n } from '../../../../../../lib/i18n';
import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';
import type { CvValidationError } from '../_lib/cv-validation';

const inputCls =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls =
  'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none disabled:opacity-50';

interface ApplyModalStep2Props {
  currentTitle: string;
  setCurrentTitle: (v: string) => void;
  currentCompany: string;
  setCurrentCompany: (v: string) => void;
  yearsExperience: string;
  setYearsExperience: (v: string) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
  coverLetter: string;
  setCoverLetter: (v: string) => void;
  cvFile: File | null;
  cvError: CvValidationError | 'upload_failed' | null;
  cvUploading: boolean;
  onCvFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onCvRemove: () => void;
}

export function ApplyModalStep2({
  currentTitle,
  setCurrentTitle,
  currentCompany,
  setCurrentCompany,
  yearsExperience,
  setYearsExperience,
  linkedinUrl,
  setLinkedinUrl,
  coverLetter,
  setCoverLetter,
  cvFile,
  cvError,
  cvUploading,
  onCvFileChange,
  onCvRemove,
}: ApplyModalStep2Props) {
  const { t } = useI18n();
  const p = t.portal;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.currentTitleLabel}</label>
          <input
            type="text"
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentTitlePlaceholder}
          />
        </div>
        <div>
          <label className={labelCls}>{p.currentCompanyLabel}</label>
          <input
            type="text"
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentCompanyPlaceholder}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>{p.yearsExpLabel}</label>
          <select
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            className={`${inputCls} bg-white`}
          >
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>LinkedIn</label>
          <input
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            maxLength={2048}
            className={inputCls}
            placeholder="https://linkedin.com/in/tu-perfil"
          />
        </div>
      </div>
      <div>
        <label className={labelCls}>{p.coverLetterLabel}</label>
        <textarea
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          maxLength={5000}
          rows={5}
          className={textareaCls}
          placeholder={p.coverLetterPlaceholder}
        />
        <p className="mt-1 text-right text-[10px] text-[#8B8B8B]">{coverLetter.length}/5000</p>
      </div>
      <CvUploadField
        file={cvFile}
        error={cvError}
        uploading={cvUploading}
        onFileChange={onCvFileChange}
        onRemove={onCvRemove}
      />
    </div>
  );
}
