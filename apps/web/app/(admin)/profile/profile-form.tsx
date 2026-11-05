'use client';

import { useState } from 'react';
import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { toast } from '../../../lib/toast';
import { usePermissions } from '../../../lib/permissions';
import { isValidTimeZone } from '@tims/shared';
import { COMMON_TIME_ZONES, timeZoneOptions } from '../../../lib/time-zone-options';

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  email: string;
  jobTitle: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
}

const FIELD_CLS =
  'w-full h-9 px-3 rounded-lg border border-[#EDEDED] bg-white text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20';
const LABEL_CLS = 'block text-[12px] font-medium text-[#585858] mb-1.5';

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
  const [timezone, setTimezone] = useState(isValidTimeZone(profile.timezone) ? profile.timezone : (COMMON_TIME_ZONES[0] ?? 'UTC'));
  const [touched, setTouched] = useState(false);

  const firstNameError = touched && firstName.trim().length === 0;
  const lastNameError = touched && lastName.trim().length === 0;
  const zones = timeZoneOptions(uiLocale === 'EN' ? 'en' : 'es', profile.timezone);

  const save = trpc.user.updateProfile.useMutation({
    onSuccess: (updated) => {
      toast(m.saved, { type: 'success' });
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

  return (
    <form onSubmit={onSubmit} noValidate className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label htmlFor="profile-first-name" className={LABEL_CLS}>
          {m.firstName} *
        </label>
        <input
          id="profile-first-name"
          value={firstName}
          maxLength={100}
          onChange={(e) => setFirstName(e.target.value)}
          aria-invalid={firstNameError || undefined}
          aria-describedby={firstNameError ? 'profile-first-name-error' : undefined}
          className={FIELD_CLS}
        />
        {firstNameError && (
          <p id="profile-first-name-error" role="alert" className="mt-1 text-xs text-[#DD0C15]">
            {m.firstNameRequired}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="profile-last-name" className={LABEL_CLS}>
          {m.lastName} *
        </label>
        <input
          id="profile-last-name"
          value={lastName}
          maxLength={100}
          onChange={(e) => setLastName(e.target.value)}
          aria-invalid={lastNameError || undefined}
          aria-describedby={lastNameError ? 'profile-last-name-error' : undefined}
          className={FIELD_CLS}
        />
        {lastNameError && (
          <p id="profile-last-name-error" role="alert" className="mt-1 text-xs text-[#DD0C15]">
            {m.lastNameRequired}
          </p>
        )}
      </div>
      <div>
        <label htmlFor="profile-email" className={LABEL_CLS}>
          {m.email}
        </label>
        <input
          id="profile-email"
          value={profile.email}
          readOnly
          aria-describedby="profile-email-hint"
          className={`${FIELD_CLS} bg-[#F6F6F6] text-[#8B8B8B]`}
        />
        <p id="profile-email-hint" className="mt-1 text-[11px] text-[#8B8B8B]">
          {m.emailHint}
        </p>
      </div>
      <div>
        <span className={LABEL_CLS}>{m.role}</span>
        <p className="h-9 flex items-center text-sm text-[#333]">{roleLabel || '—'}</p>
      </div>
      <div>
        <label htmlFor="profile-job-title" className={LABEL_CLS}>
          {m.jobTitle}
        </label>
        <input
          id="profile-job-title"
          value={jobTitle}
          maxLength={200}
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
          placeholder={m.phonePlaceholder}
          onChange={(e) => setPhone(e.target.value)}
          className={FIELD_CLS}
        />
      </div>
      <div>
        <label htmlFor="profile-language" className={LABEL_CLS}>
          {m.language}
        </label>
        <select id="profile-language" value={language} onChange={(e) => setLanguage(e.target.value)} className={FIELD_CLS}>
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
          className={FIELD_CLS}
        >
          {zones.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
        <p id="profile-time-zone-hint" className="mt-1 text-[11px] text-[#8B8B8B]">
          {m.timeZoneHint}
        </p>
      </div>
      <div className="md:col-span-2 flex justify-end pt-2">
        <button
          type="submit"
          disabled={save.isPending}
          className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
        >
          {save.isPending ? t.common.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
