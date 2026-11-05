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
import { toast } from '../../../../../lib/toast';

// text-base below `sm`: iOS Safari zooms the page on focus for any input under 16 px.
const INPUT_CLS =
  'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-base sm:text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] disabled:opacity-50';
const LABEL_CLS = 'block text-xs font-medium text-[#585858] mb-1';

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

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: toValues(profile) });
  const { errors } = form.formState;

  const update = trpc.candidatePortal.updateMyProfile.useMutation({
    onSuccess: (next) => {
      const view = { ...current, ...next };
      setCurrent(view);
      form.reset(toValues(view));
      setEditing(false);
      setSaved(true);
      toast(pd.profileSaved, { type: 'success' });
      // The greeting in the header is server-rendered from the same record.
      router.refresh();
    },
    onError: () => toast(pd.profileError, { type: 'error' }),
  });

  const startEditing = () => {
    form.reset(toValues(current));
    setSaved(false);
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
    <section aria-labelledby="portal-profile-title" className="rounded-2xl border border-[#EDEDED] bg-white p-5">
      <h2 id="portal-profile-title" className="mb-1 text-[14px] font-semibold text-[#1F114C]">
        {pd.profileTitle}
      </h2>
      <p className="mb-4 text-[12px] text-muted">{pd.profileDesc}</p>

      {editing ? (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => update.mutate({ orgSlug, ...values }))}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="portal-profile-first-name" className={LABEL_CLS}>
                {pd.profileFirstName} *
              </label>
              <input
                id="portal-profile-first-name"
                autoComplete="given-name"
                maxLength={CANDIDATE_PROFILE_NAME_MAX}
                aria-invalid={Boolean(errors.firstName)}
                className={INPUT_CLS}
                {...form.register('firstName')}
              />
            </div>
            <div>
              <label htmlFor="portal-profile-last-name" className={LABEL_CLS}>
                {pd.profileLastName} *
              </label>
              <input
                id="portal-profile-last-name"
                autoComplete="family-name"
                maxLength={CANDIDATE_PROFILE_NAME_MAX}
                aria-invalid={Boolean(errors.lastName)}
                className={INPUT_CLS}
                {...form.register('lastName')}
              />
            </div>
          </div>
          {(errors.firstName || errors.lastName) && (
            <p role="alert" className="text-[11px] text-[#DD0C15]">
              {errors.firstName?.message ?? errors.lastName?.message}
            </p>
          )}

          <div>
            <p className={LABEL_CLS}>{pd.profileEmail}</p>
            <p className="text-[13px] text-[#333]">{current.email}</p>
            <p className="mt-0.5 text-[11px] text-muted">{pd.profileEmailHint}</p>
          </div>

          <div>
            <label htmlFor="portal-profile-phone" className={LABEL_CLS}>
              {pd.profilePhone}
            </label>
            <input
              id="portal-profile-phone"
              type="tel"
              autoComplete="tel"
              maxLength={CANDIDATE_PROFILE_PHONE_MAX}
              placeholder={t.portal.phonePlaceholder}
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? 'portal-profile-phone-error' : undefined}
              className={INPUT_CLS}
              {...form.register('phone')}
            />
            {errors.phone && (
              <p id="portal-profile-phone-error" role="alert" className="mt-1 text-[11px] text-[#DD0C15]">
                {errors.phone.message}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="portal-profile-location" className={LABEL_CLS}>
              {pd.profileLocation}
            </label>
            <input
              id="portal-profile-location"
              autoComplete="address-level2"
              maxLength={CANDIDATE_PROFILE_LOCATION_MAX}
              placeholder={t.portal.cityCountryPlaceholder}
              className={INPUT_CLS}
              {...form.register('location')}
            />
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => setEditing(false)}
              className="h-10 rounded-xl border border-[#EDEDED] px-4 text-[13px] text-[#585858] hover:bg-[#F6F6F6] disabled:opacity-50"
            >
              {pd.profileCancel}
            </button>
            <button
              type="submit"
              disabled={update.isPending}
              className="h-10 rounded-xl bg-[#1F114C] px-5 text-[13px] font-semibold text-white hover:bg-[#2a1a5e] disabled:opacity-50"
            >
              {update.isPending ? pd.profileSaving : pd.profileSave}
            </button>
          </div>
        </form>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-[11px] text-muted">{row.label}</dt>
                <dd className="truncate text-[13px] text-[#333]">{row.value || pd.profileNotSet}</dd>
              </div>
            ))}
          </dl>
          {saved && (
            <p role="status" className="mt-3 text-[12px] text-[#067647]">
              {pd.profileSaved}
            </p>
          )}
          <button
            type="button"
            onClick={startEditing}
            className="mt-4 h-10 rounded-xl border border-[#1F114C] px-5 text-[13px] font-semibold text-[#1F114C] transition hover:bg-[#F4F1FF]"
          >
            {pd.profileEdit}
          </button>
        </>
      )}
    </section>
  );
}
