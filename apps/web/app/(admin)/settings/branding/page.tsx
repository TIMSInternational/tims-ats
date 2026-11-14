'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, ErrorState, Field, PageHeader, Skeleton, TextInput } from '../../../../components';
import { isCspAllowedImageUrl } from '../../../../lib/security/csp-img-src';

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function BrandingPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const org = trpc.organization.getCurrent.useQuery();
  const [logoUrl, setLogoUrl] = useState('');
  const [previewBroken, setPreviewBroken] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!initialized.current && org.data) {
      setLogoUrl(org.data.logo ?? '');
      initialized.current = true;
    }
  }, [org.data]);

  const update = trpc.organization.update.useMutation({
    onSuccess: () => {
      toast(t.branding.saved, { type: 'success' });
      utils.organization.getCurrent.invalidate();
      utils.organization.getSetupStatus.invalidate();
    },
    onError: () => {
      toast(t.branding.saveError, { type: 'error' });
    },
  });

  const trimmed = logoUrl.trim();
  const isValid = trimmed.length === 0 || isValidHttpUrl(trimmed);
  // The careers portal and the offer signing page only load images from the hosts the CSP img-src
  // allows: a logo anywhere else would never be shown to a candidate, so it cannot be saved.
  const hostAllowed = trimmed.length === 0 || !isValid || isCspAllowedImageUrl(trimmed);
  const isDirty = trimmed !== (org.data?.logo ?? '');
  const canSave = trimmed.length > 0 && isValid && hostAllowed && !previewBroken && isDirty && !update.isPending;
  const showPreview = trimmed.length > 0 && isValid && hostAllowed && !previewBroken;

  // One error at a time, in the field's error slot, so it is announced and tied to the input.
  const fieldError =
    trimmed.length > 0 && !isValid
      ? t.branding.invalidUrl
      : !hostAllowed
        ? t.branding.logoHostBlocked
        : previewBroken
          ? t.branding.previewError
          : null;

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    update.mutate({ logo: trimmed });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.branding.title} description={t.branding.description} />

      <div className="flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <section aria-labelledby="branding-logo-title" className="max-w-3xl rounded-xl bg-white p-5 shadow-card">
          <h2 id="branding-logo-title" className="mb-4 text-subheading font-semibold text-primary">
            {t.branding.logoSection}
          </h2>

          {org.isLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : org.isError ? (
            <ErrorState onRetry={() => org.refetch()} error={org.error} />
          ) : (
            <form onSubmit={onSave} className="flex flex-col gap-5 md:flex-row">
              <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface">
                {showPreview ? (
                  <img
                    src={trimmed}
                    alt={t.branding.previewAlt}
                    className="h-full w-full object-contain"
                    onError={() => setPreviewBroken(true)}
                    onLoad={() => setPreviewBroken(false)}
                  />
                ) : (
                  <span className="flex flex-col items-center gap-1 px-2 text-center text-caption text-secondary">
                    <svg
                      className="size-6 text-muted"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path d="M2.25 15.75l5.16-5.16a2.25 2.25 0 013.18 0l5.16 5.16m-1.5-1.5l1.41-1.41a2.25 2.25 0 013.18 0l2.91 2.91M3.75 19.5h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5z" />
                    </svg>
                    {t.branding.noLogo}
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <Field
                  id="branding-logo-url"
                  label={t.branding.logoLabel}
                  help={t.branding.logoHint}
                  error={fieldError}
                >
                  <TextInput
                    type="url"
                    value={logoUrl}
                    onChange={(e) => {
                      setLogoUrl(e.target.value);
                      setPreviewBroken(false);
                    }}
                    placeholder={t.branding.logoPlaceholder}
                    disabled={update.isPending}
                    maxLength={500}
                  />
                </Field>

                <div className="mt-4 flex justify-end">
                  <Button type="submit" disabled={!canSave} loading={update.isPending} loadingLabel={t.common.saving}>
                    {t.branding.save}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
