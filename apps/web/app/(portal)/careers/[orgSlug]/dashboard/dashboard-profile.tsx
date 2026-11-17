'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Lock, Pencil } from 'lucide-react';
import {
  CANDIDATE_PROFILE_LOCATION_MAX,
  CANDIDATE_PROFILE_NAME_MAX,
  CANDIDATE_PROFILE_PHONE_MAX,
  isValidCandidatePhone,
} from '@tims/shared';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { EvalButton } from './eval-button';
import { EvalCallout } from './eval-callout';
import { EvalField } from './eval-field';
import { EVAL_ACTIONS_START_CLASSES, EVAL_INPUT_CLASSES } from './eval-control-styles';
import {
  DASHBOARD_CARD,
  DASHBOARD_FACT,
  DASHBOARD_FACT_LABEL,
  DASHBOARD_FACT_VALUE,
  DASHBOARD_FACTS,
  DASHBOARD_HEADING,
  DASHBOARD_LEAD,
} from './dashboard-styles';

export interface CandidateProfileView {
  firstName: string;
  lastName: string;
  /** The session email: the portal identity, shown read-only. */
  email: string;
  phone: string | null;
  location: string | null;
}

// The section in the TIMS evaluation design (PCA): the details as FactTiles, the edit form as PCA fields. "Edit my
// details" is the section's main action (in no panel): the bar height, like Save and Cancel.
/** A blank detail ("Not provided"): the tile's value in ink2, so it reads as missing, not as data. */
const PROFILE_VALUE_EMPTY_CLASSES = 'm-0 text-eval-base text-eval-ink2';
const PROFILE_SAVED_CLASSES = 'mt-4';
const PROFILE_EDIT_BUTTON_CLASSES = 'mt-4';
const PROFILE_FORM_CLASSES = 'flex flex-col gap-4';
const PROFILE_NAME_GRID_CLASSES = 'grid grid-cols-1 gap-4 sm:grid-cols-2';
/** The read-only email: one tile, then the hint with a lock. */
const PROFILE_EMAIL_CLASSES = 'flex flex-col gap-1.5';
const PROFILE_EMAIL_TILE_CLASSES = 'm-0';
const PROFILE_EMAIL_HINT_CLASSES = 'm-0 flex items-start gap-1.5 text-eval-sm leading-[1.45] text-eval-ink2';
const PROFILE_EMAIL_HINT_ICON_CLASSES = 'mt-0.5 size-3.5 shrink-0';
const PROFILE_ACTIONS_CLASSES = `${EVAL_ACTIONS_START_CLASSES} mt-2`;

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

  // onTouched: a field says what is wrong as soon as the candidate leaves it, not only on save.
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: toValues(profile),
    mode: 'onTouched',
  });
  const { errors } = form.formState;

  const update = trpc.candidatePortal.updateMyProfile.useMutation({
    onSuccess: (next) => {
      const view = { ...current, ...next };
      setCurrent(view);
      form.reset(toValues(view));
      setEditing(false);
      setSaved(true);
      // The greeting in the header is server-rendered from the same record.
      router.refresh();
    },
    // frontend.md: onError toast on every mutation. The form stays open, so the candidate can retry.
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
    <section aria-labelledby="portal-profile-title" className={DASHBOARD_CARD}>
      <h2 id="portal-profile-title" className={DASHBOARD_HEADING}>
        {pd.profileTitle}
      </h2>
      <p className={DASHBOARD_LEAD}>{pd.profileDesc}</p>

      {editing ? (
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => update.mutate({ orgSlug, ...values }))}
          className={PROFILE_FORM_CLASSES}
        >
          <div className={PROFILE_NAME_GRID_CLASSES}>
            <EvalField
              label={pd.profileFirstName}
              required
              id="portal-profile-first-name"
              error={errors.firstName?.message}
            >
              {(c) => (
                <input
                  {...c}
                  className={EVAL_INPUT_CLASSES}
                  autoComplete="given-name"
                  maxLength={CANDIDATE_PROFILE_NAME_MAX}
                  {...form.register('firstName')}
                />
              )}
            </EvalField>
            <EvalField
              label={pd.profileLastName}
              required
              id="portal-profile-last-name"
              error={errors.lastName?.message}
            >
              {(c) => (
                <input
                  {...c}
                  className={EVAL_INPUT_CLASSES}
                  autoComplete="family-name"
                  maxLength={CANDIDATE_PROFILE_NAME_MAX}
                  {...form.register('lastName')}
                />
              )}
            </EvalField>
          </div>

          <div className={PROFILE_EMAIL_CLASSES}>
            <dl className={PROFILE_EMAIL_TILE_CLASSES}>
              <div className={DASHBOARD_FACT}>
                <dt className={DASHBOARD_FACT_LABEL}>{pd.profileEmail}</dt>
                <dd className={DASHBOARD_FACT_VALUE}>{current.email}</dd>
              </div>
            </dl>
            <p className={PROFILE_EMAIL_HINT_CLASSES}>
              <Lock aria-hidden="true" className={PROFILE_EMAIL_HINT_ICON_CLASSES} />
              <span>{pd.profileEmailHint}</span>
            </p>
          </div>

          <EvalField label={pd.profilePhone} id="portal-profile-phone" error={errors.phone?.message}>
            {(c) => (
              <input
                {...c}
                className={EVAL_INPUT_CLASSES}
                type="tel"
                autoComplete="tel"
                maxLength={CANDIDATE_PROFILE_PHONE_MAX}
                placeholder={t.portal.phonePlaceholder}
                {...form.register('phone')}
              />
            )}
          </EvalField>

          <EvalField label={pd.profileLocation} id="portal-profile-location">
            {(c) => (
              <input
                {...c}
                className={EVAL_INPUT_CLASSES}
                autoComplete="address-level2"
                maxLength={CANDIDATE_PROFILE_LOCATION_MAX}
                placeholder={t.portal.cityCountryPlaceholder}
                {...form.register('location')}
              />
            )}
          </EvalField>

          <div className={PROFILE_ACTIONS_CLASSES}>
            <EvalButton variant="secondary" disabled={update.isPending} onClick={() => setEditing(false)}>
              {pd.profileCancel}
            </EvalButton>
            <EvalButton type="submit" loading={update.isPending} loadingLabel={pd.profileSaving}>
              {pd.profileSave}
            </EvalButton>
          </div>
        </form>
      ) : (
        <>
          <dl className={DASHBOARD_FACTS}>
            {rows.map((row) => (
              <div key={row.label} className={DASHBOARD_FACT}>
                <dt className={DASHBOARD_FACT_LABEL}>{row.label}</dt>
                <dd className={row.value ? DASHBOARD_FACT_VALUE : PROFILE_VALUE_EMPTY_CLASSES}>
                  {row.value || pd.profileNotSet}
                </dd>
              </div>
            ))}
          </dl>
          {saved && (
            <EvalCallout tone="ok" role="status" className={PROFILE_SAVED_CLASSES}>
              {pd.profileSaved}
            </EvalCallout>
          )}
          <EvalButton
            variant="secondary"
            width="bar"
            icon={<Pencil aria-hidden="true" />}
            onClick={startEditing}
            className={PROFILE_EDIT_BUTTON_CLASSES}
          >
            {pd.profileEdit}
          </EvalButton>
        </>
      )}
    </section>
  );
}
