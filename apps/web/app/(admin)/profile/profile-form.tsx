'use client';

import { useEffect, useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { usePermissions } from '../../../lib/permissions';
import { isValidTimeZone } from '@tims/shared';
import { COMMON_TIME_ZONES, timeZoneOptions } from '../../../lib/time-zone-options';
import { Button } from '../../../components/button';
import {
  FIELD_ERROR_CLASSES,
  FIELD_HELP_CLASSES,
  FIELD_LABEL_CLASSES,
  inputClasses,
  selectClasses,
} from '../../../components/field-styles';

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
}

const FIELD_CLS = inputClasses();
const SELECT_CLS = selectClasses();
const LABEL_CLS = FIELD_LABEL_CLASSES;
/** How long the inline "saved" confirmation stays beside the button. */
const SAVED_NOTICE_MS = 4000;

function RequiredMark() {
  return <span aria-hidden="true">*</span>;
}

export function ProfileForm({ profile }: { profile: ProfileFormValues }) {
  const { t, locale: uiLocale, setLocale } = useI18n();
  const m = t.profile;
  const { roleLabel } = usePermissions();
  const utils = trpc.useUtils();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [jobTitle, setJobTitle] = useState(profile.jobTitle ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [language, setLanguage] = useState(profile.locale === 'en' ? 'en' : 'es');
  // A stored zone no formatter understands would be refused on save; start from the pilot default instead.
  const [timezone, setTimezone] = useState(
    isValidTimeZone(profile.timezone) ? profile.timezone : (COMMON_TIME_ZONES[0] ?? 'UTC'),
  );
  const [touched, setTouched] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [justSaved]);

  const firstNameError = touched && firstName.trim().length === 0;
  const lastNameError = touched && lastName.trim().length === 0;
  const zones = timeZoneOptions(uiLocale === 'EN' ? 'en' : 'es', profile.timezone);

  const save = trpc.user.updateProfile.useMutation({
    onSuccess: (updated) => {
      // Confirmed next to the button that did it, not in a toast across the screen.
      setJustSaved(true);
      // The interface language follows the saved preference right away.
      setLocale(updated.locale === 'en' ? 'EN' : 'ES');
      void utils.user.me.invalidate();
    },
    onError: (err) => toast(err.message || m.saveError, { type: 'error' }),
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!firstName.trim() || !lastName.trim()) return;
    save.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      jobTitle: jobTitle.trim(),
      phone: phone.trim(),
      locale: language === 'en' ? 'en' : 'es',
      timezone,
    });
  };

  const errorText = (id: string, text: string) => (
    <p id={id} role="alert" className={FIELD_ERROR_CLASSES}>
      {text}
    </p>
  );

  return (
    <div className="space-y-6">
      {/* What cannot be edited here is shown as text, not as a field that looks editable. */}
      <dl className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <dt className="text-callout text-secondary">{m.email}</dt>
          <dd className="mt-0.5 break-all text-body text-primary">{profile.email}</dd>
          <dd className={FIELD_HELP_CLASSES}>{m.emailHint}</dd>
        </div>
        <div>
          <dt className="text-callout text-secondary">{m.role}</dt>
          <dd className="mt-0.5 text-body text-primary">{roleLabel || '—'}</dd>
        </div>
      </dl>

      <form
        onSubmit={onSubmit}
        noValidate
        className="grid grid-cols-1 gap-4 border-t border-border pt-5 md:grid-cols-2"
      >
        <p className="text-callout text-secondary md:col-span-2">{m.requiredLegend}</p>
        <div>
          <label htmlFor="profile-first-name" className={LABEL_CLS}>
            {m.firstName} <RequiredMark />
          </label>
          <input
            id="profile-first-name"
            value={firstName}
            maxLength={100}
            autoComplete="given-name"
            onChange={(e) => setFirstName(e.target.value)}
            aria-required="true"
            aria-invalid={firstNameError || undefined}
            aria-describedby={firstNameError ? 'profile-first-name-error' : undefined}
            className={FIELD_CLS}
          />
          {firstNameError && errorText('profile-first-name-error', m.firstNameRequired)}
        </div>
        <div>
          <label htmlFor="profile-last-name" className={LABEL_CLS}>
            {m.lastName} <RequiredMark />
          </label>
          <input
            id="profile-last-name"
            value={lastName}
            maxLength={100}
            autoComplete="family-name"
            onChange={(e) => setLastName(e.target.value)}
            aria-required="true"
            aria-invalid={lastNameError || undefined}
            aria-describedby={lastNameError ? 'profile-last-name-error' : undefined}
            className={FIELD_CLS}
          />
          {lastNameError && errorText('profile-last-name-error', m.lastNameRequired)}
        </div>
        <div>
          <label htmlFor="profile-job-title" className={LABEL_CLS}>
            {m.jobTitle}
          </label>
          <input
            id="profile-job-title"
            value={jobTitle}
            maxLength={200}
            autoComplete="organization-title"
            onChange={(e) => setJobTitle(e.target.value)}
            className={FIELD_CLS}
          />
        </div>
        <div>
          <label htmlFor="profile-phone" className={LABEL_CLS}>
            {m.phone}
          </label>
          <input
            id="profile-phone"
            type="tel"
            value={phone}
            maxLength={20}
            autoComplete="tel"
            placeholder={m.phonePlaceholder}
            onChange={(e) => setPhone(e.target.value)}
            className={FIELD_CLS}
          />
        </div>
        <div>
          <label htmlFor="profile-language" className={LABEL_CLS}>
            {m.language}
          </label>
          <select
            id="profile-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="es">{m.languageEs}</option>
            <option value="en">{m.languageEn}</option>
          </select>
        </div>
        <div>
          <label htmlFor="profile-time-zone" className={LABEL_CLS}>
            {m.timeZone}
          </label>
          <select
            id="profile-time-zone"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            aria-describedby="profile-time-zone-hint"
            className={SELECT_CLS}
          >
            {zones.map((z) => (
              <option key={z.value} value={z.value} title={z.value}>
                {z.label}
              </option>
            ))}
          </select>
          <p id="profile-time-zone-hint" className={FIELD_HELP_CLASSES}>
            {m.timeZoneHint}
          </p>
        </div>
        <div className="flex flex-col-reverse items-stretch gap-3 pt-2 sm:flex-row sm:items-center sm:justify-end md:col-span-2">
          <p role="status" className="flex items-center gap-1.5 text-callout text-success">
            {justSaved && (
              <>
                <svg
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {m.saved}
              </>
            )}
          </p>
          <Button type="submit" loading={save.isPending} loadingLabel={t.common.saving}>
            {m.saveChanges}
          </Button>
        </div>
      </form>
    </div>
  );
}
