'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Skeleton, ErrorState } from '../../../../components';

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
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const trimmed = logoUrl.trim();
  const isValid = trimmed.length === 0 || isValidHttpUrl(trimmed);
  const isDirty = trimmed !== (org.data?.logo ?? '');
  const canSave = trimmed.length > 0 && isValid && isDirty && !update.isPending;

  const onSave = () => {
    if (!canSave) return;
    update.mutate({ logo: trimmed });
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.branding.breadcrumbParent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.branding.title}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 max-w-2xl">
          <h3 className="text-[13px] font-semibold text-[#1F114C] mb-1">{t.branding.title}</h3>
          <p className="text-[12px] text-[#8B8B8B] mb-4">{t.branding.description}</p>

          {org.isLoading ? (
            <Skeleton className="h-24 w-full rounded-lg" />
          ) : org.isError ? (
            <ErrorState onRetry={() => org.refetch()} />
          ) : (
            <div className="flex flex-col md:flex-row gap-5">
              <div className="w-28 h-28 shrink-0 rounded-lg border border-[#EDEDED] bg-[#F6F6F6] flex items-center justify-center overflow-hidden">
                {trimmed.length > 0 && isValid && !previewBroken ? (
                  <img
                    src={trimmed}
                    alt={t.branding.previewAlt}
                    className="w-full h-full object-contain"
                    onError={() => setPreviewBroken(true)}
                    onLoad={() => setPreviewBroken(false)}
                  />
                ) : (
                  <span className="text-[11px] text-[#B8B8B8] text-center px-2">
                    {previewBroken ? t.branding.previewError : t.branding.noLogo}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <label className="block text-[12px] font-medium text-[#585858] mb-1.5">
                  {t.branding.logoLabel}
                </label>
                <input
                  type="url"
                  value={logoUrl}
                  onChange={(e) => {
                    setLogoUrl(e.target.value);
                    setPreviewBroken(false);
                  }}
                  placeholder={t.branding.logoPlaceholder}
                  disabled={update.isPending}
                  maxLength={500}
                  className="w-full border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] placeholder:text-[#B8B8B8] focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
                />
                <p className="text-[11px] text-[#8B8B8B] mt-1.5">{t.branding.logoHint}</p>
                {trimmed.length > 0 && !isValid && (
                  <p className="text-[11px] text-[#DD0C15] mt-1">{t.branding.invalidUrl}</p>
                )}

                <div className="flex justify-end mt-4">
                  <button
                    type="button"
                    onClick={onSave}
                    disabled={!canSave}
                    className="h-9 px-4 rounded-lg text-[12px] font-medium bg-[#DD0C15] text-white hover:bg-[#c00b13] transition disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {update.isPending ? t.common.saving : t.common.save}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
