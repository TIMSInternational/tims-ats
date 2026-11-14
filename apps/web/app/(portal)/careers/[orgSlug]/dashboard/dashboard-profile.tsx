'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  CANDIDATE_PROFILE_LOCATION_MAX,
  CANDIDATE_PROFILE_NAME_MAX,
  CANDIDATE_PROFILE_PHONE_MAX,
  isValidCandidatePhone,
} from '@tims/shared';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { Button } from '../../../../../components/button';
import { Field } from '../../../../../components/field';
import { TextInput } from '../../../../../components/text-input';
import { BUTTON_GROUP_CLASSES } from '../../../../../components/button-styles';
import { DASHBOARD_CARD, DASHBOARD_TITLE } from './dashboard-styles';

export interface CandidateProfileView {
  firstName: string;
  lastName: string;
  /** The session email: the portal identity, shown read-only. */
  email: string;
  phone: string | null;
  location: string | null;
}

// "Mis datos" (audit C-33): the signed-in candidate sees and corrects their own name, phone and location.
// The values come server-rendered from the dashboard page; the email is never editable (it is the login).
export function DashboardProfile({ orgSlug, profile }: { orgSlug: string; profile: CandidateProfileView }) {
  const router = useRouter();
  const { t } = useI18n();
  const pd = t.portalDashboard;
  const [current, setCurrent] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Same bounds as the server (candidatePortalProfileSchema), with candidate-facing messages.
  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1, pd.profileNameRequired).max(CANDIDATE_PROFILE_NAME_MAX),
        lastName: z.string().trim().min(1, pd.profileNameRequired).max(CANDIDATE_PROFILE_NAME_MAX),
        phone: z
          .string()
          .trim()
          .max(CANDIDATE_PROFILE_PHONE_MAX, pd.profilePhoneInvalid)
          .refine(isValidCandidatePhone, pd.profilePhoneInvalid),
        location: z.string().trim().max(CANDIDATE_PROFILE_LOCATION_MAX),
      }),
    [pd.profileNameRequired, pd.profilePhoneInvalid],
  );
  type FormValues = z.infer<typeof schema>;

  const toValues = (view: CandidateProfileView): FormValues => ({
    firstName: view.firstName,
    lastName: view.lastName,
    phone: view.phone ?? '',
    location: view.location ?? '',
  });

  // onTouched: a field says what is wrong as soon as the candidate leaves it, not only on save.
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(profile), mode: 'onTouched' });
  const { errors } = form.formState;

  const update = trpc.candidatePortal.updateMyProfile.useMutation({
    onSuccess: (next) => {
      const view = { ...current, ...next };
      setCurrent(view);
      form.reset(toValues(view));
      setEditing(false);
      setSaved(true);
      setSaveFailed(false);
      // The greeting in the header is server-rendered from the same record.
      router.refresh();
    },
    // Said inline above the buttons: the form is still open, so the candidate can retry right there.
    onError: () => setSaveFailed(true),
  });

  const startEditing = () => {
    form.reset(toValues(current));
    setSaved(false);
    setSaveFailed(false);
    setEditing(true);
  };

  const rows: Array<{ label: string; value: string | null }> = [
    { label: pd.profileFirstName, value: current.firstName },
    { label: pd.profileLastName, value: current.lastName },
    { label: pd.profileEmail, value: current.email },
    { label: pd.profilePhone, value: current.phone },
    { label: pd.profileLocation, value: current.location },
  ];

  return (
    <section aria-labelledby="portal-profile-title" className={DASHBOARD_CARD}>
      <h2 id="portal-profile-title" className={`${DASHBOARD_TITLE} mb-1`}>
        {pd.profileTitle}
      </h2>
      <p className="mb-4 text-base text-secondary sm:text-body">{pd.profileDesc}</p>

      {editing ? (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            setSaveFailed(false);
            update.mutate({ orgSlug, ...values });
          })}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={pd.profileFirstName} required id="portal-profile-first-name" error={errors.firstName?.message}>
              {(c) => <TextInput {...c} autoComplete="given-name" maxLength={CANDIDATE_PROFILE_NAME_MAX} {...form.register('firstName')} />}
            </Field>
            <Field label={pd.profileLastName} required id="portal-profile-last-name" error={errors.lastName?.message}>
              {(c) => <TextInput {...c} autoComplete="family-name" maxLength={CANDIDATE_PROFILE_NAME_MAX} {...form.register('lastName')} />}
            </Field>
          </div>

          <div>
            <p className="mb-1.5 text-body font-medium text-primary">{pd.profileEmail}</p>
            <p className="text-base text-primary sm:text-body">{current.email}</p>
            <p className="mt-0.5 text-callout text-secondary">{pd.profileEmailHint}</p>
          </div>

          <Field label={pd.profilePhone} id="portal-profile-phone" error={errors.phone?.message}>
            {(c) => (
              <TextInput
                {...c}
                type="tel"
                autoComplete="tel"
                maxLength={CANDIDATE_PROFILE_PHONE_MAX}
                placeholder={t.portal.phonePlaceholder}
                {...form.register('phone')}
              />
            )}
          </Field>

          <Field label={pd.profileLocation} id="portal-profile-location">
            {(c) => (
              <TextInput
                {...c}
                autoComplete="address-level2"
                maxLength={CANDIDATE_PROFILE_LOCATION_MAX}
                placeholder={t.portal.cityCountryPlaceholder}
                {...form.register('location')}
              />
            )}
          </Field>

          {saveFailed && (
            <p role="alert" className="rounded-lg bg-danger-bg p-3 text-callout text-danger">
              {pd.profileError}
            </p>
          )}

          <div className={BUTTON_GROUP_CLASSES}>
            <Button variant="secondary" disabled={update.isPending} onClick={() => setEditing(false)}>
              {pd.profileCancel}
            </Button>
            <Button type="submit" loading={update.isPending} loadingLabel={pd.profileSaving}>
              {pd.profileSave}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-callout text-secondary">{row.label}</dt>
                <dd className="break-words text-base text-primary sm:text-body">{row.value || pd.profileNotSet}</dd>
              </div>
            ))}
          </dl>
          {saved && (
            <p role="status" className="mt-3 text-callout text-success">
              {pd.profileSaved}
            </p>
          )}
          <Button variant="secondary" onClick={startEditing} className="mt-4">
            {pd.profileEdit}
          </Button>
        </>
      )}
    </section>
  );
}
