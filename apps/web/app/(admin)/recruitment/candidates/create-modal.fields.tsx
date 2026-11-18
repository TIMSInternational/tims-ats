'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { CHOICE_INPUT_CLASSES, Field, Select, TextArea, TextInput } from '../../../../components';
import {
  CANDIDATE_STAFF_POOL_TYPES,
  candidatePoolLabel,
  candidatePoolOptionLabel,
  candidateSourceLabel,
} from '../../../../lib/candidate-labels';
import { SOURCES, EXPERIENCE_LEVELS, CHOICE_CARD_CLASSES, LEGEND_CLASSES } from './create-modal.helpers';

// Fields are stacked on phones and paired from sm (text-fields.md › Best practices: "Stack multiple text
// fields vertically when possible"). Every control has a real <label> through Field; placeholders only hint.
const PAIR = 'grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-3';

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
  /** Inline error for the email field (e.g. the address is already registered). */
  emailError?: string;
}

export function Step1Fields(p: Step1FieldsProps) {
  const { t } = useI18n();
  const c = t.candidates;
  return (
    <div className="space-y-4">
      <p className="text-callout text-secondary">
        <span aria-hidden="true">* </span>
        {c.requiredNote}
      </p>
      <div className={PAIR}>
        <Field label={c.firstName} required id="cand-first-name">
          <TextInput
            value={p.firstName}
            onChange={(e) => p.setFirstName(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={c.formFirstNamePlaceholder}
            autoFocus
          />
        </Field>
        <Field label={c.lastName} required id="cand-last-name">
          <TextInput
            value={p.lastName}
            onChange={(e) => p.setLastName(e.target.value)}
            maxLength={120}
            autoComplete="off"
            placeholder={c.formLastNamePlaceholder}
          />
        </Field>
      </div>
      <div className={PAIR}>
        <Field label={c.email} required id="cand-email" error={p.emailError}>
          <TextInput
            type="email"
            value={p.email}
            onChange={(e) => p.setEmail(e.target.value)}
            maxLength={254}
            autoComplete="off"
            placeholder="maria.lopez@gmail.com"
          />
        </Field>
        <Field label={c.phone} id="cand-phone">
          <TextInput
            type="tel"
            value={p.phone}
            onChange={(e) => p.setPhone(e.target.value)}
            maxLength={30}
            placeholder={c.formPhonePlaceholder}
          />
        </Field>
      </div>
      <Field label={c.location} id="cand-location">
        <TextInput
          value={p.location}
          onChange={(e) => p.setLocation(e.target.value)}
          maxLength={200}
          placeholder={c.formLocationPlaceholder}
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
  yearsExperience: number;
  setYearsExperience: (v: number) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
  skills: string;
  setSkills: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}

export function Step2Fields(p: Step2FieldsProps) {
  const { t } = useI18n();
  const c = t.candidates;
  return (
    <div className="space-y-4">
      <div className={PAIR}>
        <Field label={c.currentTitle} id="cand-title">
          <TextInput
            value={p.currentTitle}
            onChange={(e) => p.setCurrentTitle(e.target.value)}
            maxLength={200}
            placeholder={c.formCurrentTitlePlaceholder}
          />
        </Field>
        <Field label={c.currentCompany} id="cand-company">
          <TextInput
            value={p.currentCompany}
            onChange={(e) => p.setCurrentCompany(e.target.value)}
            maxLength={200}
            placeholder="MercadoLibre"
          />
        </Field>
      </div>
      <div className={PAIR}>
        <Field label={c.formYearsExpLabel} id="cand-years">
          <Select value={p.yearsExperience} onChange={(e) => p.setYearsExperience(parseInt(e.target.value))}>
            {EXPERIENCE_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {c[l.labelKey]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={c.linkedinUrl} id="cand-linkedin">
          <TextInput
            type="url"
            value={p.linkedinUrl}
            onChange={(e) => p.setLinkedinUrl(e.target.value)}
            maxLength={2048}
            placeholder="https://linkedin.com/in/maria-lopez"
          />
        </Field>
      </div>
      <Field label={c.formKeySkillsLabel} help={c.formSkillsHint} id="cand-skills">
        <TextInput
          value={p.skills}
          onChange={(e) => p.setSkills(e.target.value)}
          maxLength={500}
          placeholder={c.formKeySkillsPlaceholder}
        />
      </Field>
      <Field label={c.formRecruiterNotesLabel} id="cand-notes">
        <TextArea
          value={p.notes}
          onChange={(e) => p.setNotes(e.target.value)}
          maxLength={5000}
          rows={3}
          placeholder={c.formRecruiterNotesPlaceholder}
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
  location: string;
  skills: string;
}

export function Step3Fields(props: Step3FieldsProps) {
  const { t } = useI18n();
  const c = t.candidates;
  const skillList = props.skills
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const role = props.currentCompany
    ? formatMessage(c.summaryRoleAt, { title: props.currentTitle, company: props.currentCompany })
    : props.currentTitle;
  const rows: { label: string; value: string }[] = [
    { label: c.summaryName, value: `${props.firstName} ${props.lastName}` },
    { label: c.summaryEmail, value: props.email },
    ...(props.currentTitle ? [{ label: c.summaryRole, value: role }] : []),
    ...(props.location ? [{ label: c.summaryLocation, value: props.location }] : []),
    { label: c.summarySource, value: candidateSourceLabel(props.source, c) },
    { label: c.summaryType, value: candidatePoolLabel(props.poolType, c) },
    ...(skillList.length
      ? [{ label: c.summarySkills, value: `${skillList.slice(0, 4).join(', ')}${skillList.length > 4 ? '…' : ''}` }]
      : []),
  ];

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className={LEGEND_CLASSES}>{c.formHowCandidateArrived}</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SOURCES.map((s) => (
            <label key={s} className={CHOICE_CARD_CLASSES}>
              <input
                type="radio"
                name="cand-source"
                value={s}
                checked={props.source === s}
                onChange={() => props.setSource(s)}
                className={CHOICE_INPUT_CLASSES}
              />
              {candidateSourceLabel(s, c)}
            </label>
          ))}
        </div>
      </fieldset>

      {props.source === 'referral' && (
        <Field label={c.formReferrerNameLabel} id="cand-referrer">
          <TextInput
            value={props.referrerName}
            onChange={(e) => props.setReferrerName(e.target.value)}
            maxLength={200}
            placeholder={c.formReferrerNamePlaceholder}
          />
        </Field>
      )}

      <fieldset>
        <legend className={LEGEND_CLASSES}>{c.formCandidateTypeLabel}</legend>
        <div className="space-y-2">
          {CANDIDATE_STAFF_POOL_TYPES.map((p) => (
            <label key={p} className={CHOICE_CARD_CLASSES}>
              <input
                type="radio"
                name="cand-pool-type"
                value={p}
                checked={props.poolType === p}
                onChange={(e) => props.setPoolType(e.target.value)}
                className={CHOICE_INPUT_CLASSES}
              />
              {candidatePoolOptionLabel(p, t.candidates)}
            </label>
          ))}
        </div>
      </fieldset>

      <section aria-labelledby="cand-summary-title" className="border-t border-border pt-4">
        <h3 id="cand-summary-title" className="mb-2 text-subheading font-semibold text-primary">
          {c.summaryTitle}
        </h3>
        <dl className="space-y-1.5 rounded-lg bg-surface p-3">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4">
              <dt className="text-callout text-secondary">{row.label}</dt>
              <dd className="break-words text-callout font-medium text-primary sm:text-right">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
