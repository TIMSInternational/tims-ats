'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useI18n } from '../../../../../../lib/i18n';
import { toast } from '../../../../../../lib/toast';
import { PROVIDER_INSTRUMENTS } from '../../../../../../lib/platform-api/assessment-providers-staff';
import {
  adminErrorCode,
  BINDING_LOCALES,
  useBindOrganization,
  type ProviderBindingState,
} from '../../../../../../lib/platform-api/assessment-provider-admin';

const bindSchema = z.object({
  instruments: z.array(z.enum(PROVIDER_INSTRUMENTS)).max(PROVIDER_INSTRUMENTS.length),
  defaultLocale: z.enum(BINDING_LOCALES),
});

type BindForm = z.infer<typeof bindSchema>;

// Binds the organization to TIMS Assessments (or updates its enabled tests and default language). The provider only
// accepts tests it offers for selection; its refusal is shown by code. Platform owner only (C# PlatformOwnerGate).
export function AssessmentProviderBindingForm({
  organizationId,
  state,
}: {
  organizationId: string;
  state: ProviderBindingState;
}) {
  const { t } = useI18n();
  const pa = t.providerAdmin;
  const bind = useBindOrganization(organizationId);
  const form = useForm<BindForm>({
    resolver: zodResolver(bindSchema),
    defaultValues: {
      instruments: state.active ? state.enabledInstruments : [],
      defaultLocale: state.defaultLocale === 'en' ? 'en' : 'es',
    },
  });
  const errorKey = bind.isError ? adminErrorCode(bind.error) : null;
  const errorText = errorKey ? ((pa.errors as Record<string, string>)[errorKey] ?? pa.errors.unknown) : null;

  const submit = form.handleSubmit((values) =>
    bind.mutate(values, {
      onSuccess: () => toast(pa.bound, { type: 'success' }),
      onError: () => toast(pa.errors.unknown, { type: 'error' }),
    }),
  );

  return (
    <form onSubmit={submit} aria-labelledby="provider-bind-title" className="space-y-3">
      <h4 id="provider-bind-title" className="text-[13px] font-semibold text-[#1F114C]">
        {pa.bindTitle}
      </h4>
      <fieldset className="space-y-1">
        <legend className="text-[12px] font-medium text-[#585858] mb-1">{pa.instrumentsLegend}</legend>
        <div className="flex flex-wrap gap-3">
          {PROVIDER_INSTRUMENTS.map((instrument) => (
            <label key={instrument} className="flex items-center gap-1.5 text-[12px] text-[#1F114C]">
              <input type="checkbox" value={instrument} {...form.register('instruments')} />
              {pa.instrument[instrument]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-[12px] font-medium text-[#585858] max-w-xs">
        {pa.localeLabel}
        <select {...form.register('defaultLocale')} className="h-9 rounded-lg border border-[#EDEDED] px-2 text-[13px]">
          <option value="es">{pa.localeEs}</option>
          <option value="en">{pa.localeEn}</option>
        </select>
      </label>
      {errorText && (
        <p role="alert" className="text-[12px] text-[#B42318]">
          {errorText}
        </p>
      )}
      <button
        type="submit"
        disabled={bind.isPending}
        className="h-9 rounded-lg bg-[#1F114C] px-4 text-[12px] font-semibold text-white disabled:opacity-50"
      >
        {bind.isPending ? pa.bindSaving : pa.bindSubmit}
      </button>
    </form>
  );
}
