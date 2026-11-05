'use client';

import { useId, useState } from 'react';
import { CvUploadField } from './cv-upload-field';
import { useI18n } from '../../../../../../lib/i18n';
import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';
import { isValidLinkedinUrl, normalizeLinkedinUrl } from '../_lib/apply-fields';
import type { CvValidationError } from '../_lib/cv-validation';

// text-base below `sm`: iOS Safari zooms the page on focus for any input under 16 px.
const inputCls =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-base sm:text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50 disabled:bg-[#FAFAFA]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls =
  'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-base sm:text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none disabled:opacity-50';

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
  /** The server rejected the LinkedIn URL: show the field error even before the field is touched again. */
  profileLinkRejected?: boolean;
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
  profileLinkRejected = false,
}: ApplyModalStep2Props) {
  const { t } = useI18n();
  const p = t.portal;
  const idBase = useId();
  const [profileLinkTouched, setProfileLinkTouched] = useState(false);
  const showLinkedinError = profileLinkRejected || (profileLinkTouched && !isValidLinkedinUrl(linkedinUrl));
  const ids = {
    currentTitle: `${idBase}-current-title`,
    currentCompany: `${idBase}-current-company`,
    yearsExperience: `${idBase}-years-experience`,
    linkedinUrl: `${idBase}-linkedin`,
    linkedinError: `${idBase}-linkedin-error`,
    coverLetter: `${idBase}-cover-letter`,
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.currentTitle} className={labelCls}>{p.currentTitleLabel}</label>
          <input
            type="text"
            id={ids.currentTitle}
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentTitlePlaceholder}
          />
        </div>
        <div>
          <label htmlFor={ids.currentCompany} className={labelCls}>{p.currentCompanyLabel}</label>
          <input
            type="text"
            id={ids.currentCompany}
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            maxLength={200}
            className={inputCls}
            placeholder={p.currentCompanyPlaceholder}
          />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={ids.yearsExperience} className={labelCls}>{p.yearsExpLabel}</label>
          <select
            id={ids.yearsExperience}
            value={yearsExperience}
            onChange={(e) => setYearsExperience(e.target.value)}
            className={`${inputCls} bg-white`}
          >
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {p.experienceLevels[l.labelKey]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={ids.linkedinUrl} className={labelCls}>LinkedIn</label>
          {/* type="text" + inputMode="url": the browser's own url validation never runs (there is no
              <form>), and the value is normalized to https:// on blur so "linkedin.com/in/…" is accepted. */}
          <input
            type="text"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            id={ids.linkedinUrl}
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            onBlur={() => {
              setProfileLinkTouched(true);
              setLinkedinUrl(normalizeLinkedinUrl(linkedinUrl));
            }}
            maxLength={2048}
            className={inputCls}
            placeholder={p.linkedinPlaceholder}
            aria-invalid={showLinkedinError || undefined}
            aria-describedby={showLinkedinError ? ids.linkedinError : undefined}
          />
          {showLinkedinError && (
            <p id={ids.linkedinError} className="mt-1 text-[11px] text-[#DD0C15]">
              {p.linkedinInvalid}
            </p>
          )}
        </div>
      </div>
      <div>
        <label htmlFor={ids.coverLetter} className={labelCls}>{p.coverLetterLabel}</label>
        <textarea
          id={ids.coverLetter}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          maxLength={5000}
          rows={5}
          className={textareaCls}
          placeholder={p.coverLetterPlaceholder}
        />
        <p className="mt-1 text-right text-[10px] text-muted">{coverLetter.length}/5000</p>
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
