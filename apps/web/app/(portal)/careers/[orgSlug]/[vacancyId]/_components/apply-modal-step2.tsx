'use client';

import { useState } from 'react';
import { Field } from '../../../../../../components/field';
import { TextInput } from '../../../../../../components/text-input';
import { TextArea } from '../../../../../../components/text-area';
import { Select } from '../../../../../../components/select';
import { CvUploadField } from './cv-upload-field';
import { useI18n } from '../../../../../../lib/i18n';
import { EXPERIENCE_LEVELS } from '../_lib/experience-levels';
import { isValidLinkedinUrl, normalizeLinkedinUrl } from '../_lib/apply-fields';
import type { CvValidationError } from '../_lib/cv-validation';

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
  const [profileLinkTouched, setProfileLinkTouched] = useState(false);
  const showLinkedinError = profileLinkRejected || (profileLinkTouched && !isValidLinkedinUrl(linkedinUrl));
  // Every field on this step is optional, and each label says so.
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={p.currentTitleLabel} optional>
          <TextInput
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            maxLength={200}
            placeholder={p.currentTitlePlaceholder}
          />
        </Field>
        <Field label={p.currentCompanyLabel} optional>
          <TextInput
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            maxLength={200}
            placeholder={p.currentCompanyPlaceholder}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={p.yearsExpLabel} optional>
          <Select value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)}>
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {p.experienceLevels[l.labelKey]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={p.linkedinLabel} optional error={showLinkedinError ? p.linkedinInvalid : undefined}>
          {/* type="text" + inputMode="url": the browser's own url validation never runs (there is no
              <form>), and the value is normalized to https:// on blur so "linkedin.com/in/…" is accepted. */}
          <TextInput
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            onBlur={() => {
              setProfileLinkTouched(true);
              setLinkedinUrl(normalizeLinkedinUrl(linkedinUrl));
            }}
            maxLength={2048}
            placeholder={p.linkedinPlaceholder}
          />
        </Field>
      </div>
      <Field label={p.coverLetterLabel} optional>
        {(c) => (
          <>
            <TextArea
              {...c}
              value={coverLetter}
              onChange={(e) => setCoverLetter(e.target.value)}
              maxLength={5000}
              rows={5}
              className="resize-none"
              placeholder={p.coverLetterPlaceholder}
            />
            <p className="mt-1 text-right text-caption text-muted tabular-nums" aria-hidden="true">
              {coverLetter.length}/5000
            </p>
          </>
        )}
      </Field>
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
