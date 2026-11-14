'use client';

import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { PlatformApiError } from '../../../../lib/platform-api/client';
import {
  ANTI_CHEAT_CONSEQUENCES,
  MAX_THRESHOLD,
  MIN_THRESHOLD,
  useSaveProctoringSettings,
  type ProctoringSettings,
} from '../../../../lib/platform-api/assessment-provider-settings';
import { SettingSwitch } from './setting-switch';
import { ThresholdStepper } from './threshold-stepper';

const formSchema = z.object({
  lockdown: z.boolean(),
  antiCheatEnabled: z.boolean(),
  threshold: z.number().int().min(MIN_THRESHOLD).max(MAX_THRESHOLD),
  consequence: z.enum(ANTI_CHEAT_CONSEQUENCES),
  identityCheck: z.boolean(),
});

type SecurityForm = z.infer<typeof formSchema>;

// The suite's defaults when alert control is first turned on: three alerts, then submit for review.
const DEFAULT_THRESHOLD = 3;

function toForm(settings: ProctoringSettings): SecurityForm {
  return {
    lockdown: settings.lockdown,
    antiCheatEnabled: settings.antiCheat !== null,
    threshold: settings.antiCheat?.threshold ?? DEFAULT_THRESHOLD,
    consequence: settings.antiCheat?.consequence ?? 'auto_submit',
    identityCheck: settings.identityCheck,
  };
}

// The org's assessment security: three settings, one primary action. Each setting says in plain words what happens to
// the candidate's sitting; the identity check stays off and disabled until an approved biometric consent text exists.
export function AssessmentSecurityForm({ settings }: { settings: ProctoringSettings }) {
  const { t, locale } = useI18n();
  const m = t.assessmentSecurity;
  const form = useForm<SecurityForm>({ resolver: zodResolver(formSchema), defaultValues: toForm(settings) });
  const save = useSaveProctoringSettings({
    onSuccess: () => toast(m.saved, { type: 'success' }),
    onError: (error) =>
      toast(
        error instanceof PlatformApiError && error.status === 422
          ? m.identityRefused
          : error instanceof PlatformApiError && error.status === 403
            ? m.noPermission
            : m.saveError,
        { type: 'error' },
      ),
  });
  const antiCheatEnabled = form.watch('antiCheatEnabled');
  const updated = settings.updatedAt
    ? new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(settings.updatedAt),
      )
    : null;

  const submit = form.handleSubmit((values) =>
    save.mutate(
      {
        lockdown: values.lockdown,
        antiCheat: values.antiCheatEnabled ? { threshold: values.threshold, consequence: values.consequence } : null,
        identityCheck: settings.identityCheckAvailable && values.identityCheck,
      },
      { onSuccess: (saved) => form.reset(toForm(saved)) },
    ),
  );

  return (
    <form
      onSubmit={submit}
      aria-label={m.title}
      className="max-w-2xl rounded-xl bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]"
    >
      <Controller
        control={form.control}
        name="lockdown"
        render={({ field }) => (
          <SettingSwitch
            id="lockdown"
            label={m.lockdownLabel}
            help={m.lockdownHelp}
            checked={field.value}
            onChange={field.onChange}
          />
        )}
      />
      <Controller
        control={form.control}
        name="antiCheatEnabled"
        render={({ field }) => (
          <SettingSwitch
            id="anti-cheat"
            label={m.antiCheatLabel}
            help={m.antiCheatHelp}
            checked={field.value}
            onChange={field.onChange}
          >
            {antiCheatEnabled ? (
              <div className="mt-4 flex flex-col gap-4 rounded-lg bg-[#FAFAFA] p-4">
                <Controller
                  control={form.control}
                  name="threshold"
                  render={({ field: threshold }) => (
                    <ThresholdStepper value={threshold.value} onChange={threshold.onChange} />
                  )}
                />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-[12px] font-medium text-[#585858]">{m.consequenceLegend}</legend>
                  {ANTI_CHEAT_CONSEQUENCES.map((consequence) => (
                    <label key={consequence} className="flex items-start gap-2 text-[13px] text-[#1F114C]">
                      <input type="radio" value={consequence} className="mt-1" {...form.register('consequence')} />
                      <span>
                        <span className="font-medium">{m.consequence[consequence].label}</span>
                        <span className="block text-[12px] text-[#585858]">{m.consequence[consequence].help}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-[#8B8B8B]">{m.antiCheatOffHint}</p>
            )}
          </SettingSwitch>
        )}
      />
      <Controller
        control={form.control}
        name="identityCheck"
        render={({ field }) => (
          <SettingSwitch
            id="identity-check"
            label={m.identityLabel}
            help={m.identityHelp}
            checked={settings.identityCheckAvailable && field.value}
            disabled={!settings.identityCheckAvailable}
            onChange={field.onChange}
          >
            {!settings.identityCheckAvailable && (
              <p
                className="mt-2 rounded-lg bg-amber-50 p-3 text-[12px] text-amber-900"
                data-testid="identity-unavailable"
              >
                {m.identityUnavailable}
              </p>
            )}
          </SettingSwitch>
        )}
      />
      <div className="mt-4 space-y-1 text-[12px] text-[#585858]">
        <p>{m.appliesNote}</p>
        <p>{m.pcaNote}</p>
        {updated && <p className="text-[11px] text-[#8B8B8B]">{m.updatedAt.replace('{date}', updated)}</p>}
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={save.isPending || !form.formState.isDirty}
          className="h-9 rounded-lg bg-[#1F114C] px-4 text-[13px] font-semibold text-white hover:bg-[#2a1866] transition disabled:opacity-50"
        >
          {save.isPending ? m.saving : m.save}
        </button>
      </div>
    </form>
  );
}
