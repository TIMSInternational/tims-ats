'use client';

import { SOURCES, EXPERIENCE_LEVELS } from './add-candidate-modal.helpers';
import { useI18n } from '../../../../lib/i18n';
import { Field, Select, TextArea, TextInput } from '../../../../components';
import { AddCandidateSummary } from './add-candidate-summary';
import {
  CANDIDATE_STAFF_POOL_TYPES,
  candidatePoolOptionLabel,
  candidateSourceLabel,
} from '../../../../lib/candidate-labels';

interface Step1FieldsProps {
  firstName: string;
  setFirstName: (v: string) => void;
  lastName: string;
  setLastName: (v: string) => void;
  email: string;
  setEmail: (v: string) => void;
  phone: string;
  setPhone: (v: string) => void;
  location: string;
  setLocation: (v: string) => void;
}

export function Step1Fields({
  firstName,
  setFirstName,
  lastName,
  setLastName,
  email,
  setEmail,
  phone,
  setPhone,
  location,
  setLocation,
}: Step1FieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <p className="text-callout text-secondary">{t.pipeline.requiredNote}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.candidates.formFirstName} required>
          <TextInput
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={t.pipeline.addCandidateFirstNamePlaceholder}
            autoFocus
          />
        </Field>
        <Field label={t.candidates.formLastName} required>
          <TextInput
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={t.candidates.formLastNamePlaceholder}
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.candidates.email} required>
          <TextInput
            type="email"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            maxLength={254}
            autoComplete="off"
            placeholder="maria.lopez@gmail.com"
          />
        </Field>
        <Field label={t.candidates.phone}>
          <TextInput
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            maxLength={30}
            autoComplete="off"
            placeholder={t.candidates.formPhonePlaceholder}
          />
        </Field>
      </div>
      <Field label={t.candidates.location}>
        <TextInput
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={200}
          placeholder={t.candidates.formLocationPlaceholder}
        />
      </Field>
    </div>
  );
}

interface Step2FieldsProps {
  currentTitle: string;
  setCurrentTitle: (v: string) => void;
  currentCompany: string;
  setCurrentCompany: (v: string) => void;
  yearsExperience: string;
  setYearsExperience: (v: string) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
  skills: string;
  setSkills: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}

export function Step2Fields({
  currentTitle,
  setCurrentTitle,
  currentCompany,
  setCurrentCompany,
  yearsExperience,
  setYearsExperience,
  linkedinUrl,
  setLinkedinUrl,
  skills,
  setSkills,
  notes,
  setNotes,
}: Step2FieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.candidates.formCurrentTitleLabel}>
          <TextInput
            value={currentTitle}
            onChange={(e) => setCurrentTitle(e.target.value)}
            maxLength={200}
            placeholder={t.candidates.formCurrentTitlePlaceholder}
            autoFocus
          />
        </Field>
        <Field label={t.candidates.formCurrentCompanyLabel}>
          <TextInput
            value={currentCompany}
            onChange={(e) => setCurrentCompany(e.target.value)}
            maxLength={200}
            placeholder="MercadoLibre"
          />
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={t.candidates.formYearsExpLabel}>
          <Select value={yearsExperience} onChange={(e) => setYearsExperience(e.target.value)}>
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {t.pipeline.experienceLevels[l.labelKey]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t.candidates.linkedinUrl}>
          <TextInput
            type="url"
            inputMode="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://linkedin.com/in/maria-lopez"
          />
        </Field>
      </div>
      <Field label={t.candidates.formKeySkillsLabel} help={t.candidates.formSkillsHint}>
        <TextInput
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          maxLength={500}
          placeholder={t.candidates.formKeySkillsPlaceholder}
        />
      </Field>
      <Field label={t.candidates.formRecruiterNotesLabel}>
        <TextArea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder={t.candidates.formRecruiterNotesPlaceholder}
        />
      </Field>
    </div>
  );
}

interface Step3FieldsProps {
  source: string;
  setSource: (v: string) => void;
  poolType: string;
  setPoolType: (v: string) => void;
  referrerName: string;
  setReferrerName: (v: string) => void;
  firstName: string;
  lastName: string;
  email: string;
  currentTitle: string;
  currentCompany: string;
  skills: string;
  vacancyTitle: string;
}

export function Step3Fields({
  source,
  setSource,
  poolType,
  setPoolType,
  referrerName,
  setReferrerName,
  firstName,
  lastName,
  email,
  currentTitle,
  currentCompany,
  skills,
  vacancyTitle,
}: Step3FieldsProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      {/* Native radios styled as tiles: the chosen source is exposed to screen readers, not only by colour
          (entering-data.md). */}
      <fieldset>
        <legend className="mb-3 text-body font-semibold text-brand">{t.candidates.formHowCandidateArrived}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <label
              key={s}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-field-border px-3 py-2 text-body text-secondary transition-colors hover:bg-surface has-[:checked]:border-brand has-[:checked]:bg-brand-tint has-[:checked]:font-medium has-[:checked]:text-brand"
            >
              <input
                type="radio"
                name="candidateSource"
                value={s}
                checked={source === s}
                onChange={() => setSource(s)}
                className="size-4 shrink-0 accent-brand"
              />
              {candidateSourceLabel(s, t.candidates)}
            </label>
          ))}
        </div>
      </fieldset>

      {source === 'referral' && (
        <Field label={t.candidates.formReferrerNameLabel}>
          <TextInput
            value={referrerName}
            onChange={(e) => setReferrerName(e.target.value)}
            maxLength={200}
            placeholder={t.candidates.formReferrerNamePlaceholder}
          />
        </Field>
      )}

      <fieldset>
        <legend className="mb-3 text-body font-semibold text-brand">{t.candidates.formCandidateTypeLabel}</legend>
        <div className="space-y-2">
          {CANDIDATE_STAFF_POOL_TYPES.map((p) => (
            <label
              key={p}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-field-border px-3 py-2 transition-colors hover:bg-surface has-[:checked]:border-brand has-[:checked]:bg-brand-tint"
            >
              <input
                type="radio"
                name="poolType"
                value={p}
                checked={poolType === p}
                onChange={(e) => setPoolType(e.target.value)}
                className="size-4 shrink-0 accent-brand"
              />
              <span className={`text-body ${poolType === p ? 'font-medium text-brand' : 'text-secondary'}`}>
                {candidatePoolOptionLabel(p, t.candidates)}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <AddCandidateSummary
        firstName={firstName}
        lastName={lastName}
        email={email}
        currentTitle={currentTitle}
        currentCompany={currentCompany}
        source={source}
        skills={skills}
        vacancyTitle={vacancyTitle}
      />
    </div>
  );
}
