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
import { Button, CHOICE_INPUT_CLASSES } from '../../../../components';
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
    <form onSubmit={submit} aria-label={m.title} className="max-w-3xl rounded-xl bg-white p-4 shadow-card md:p-5">
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
              <div className="mt-3 flex flex-col gap-4 rounded-lg bg-surface p-4">
                <Controller
                  control={form.control}
                  name="threshold"
                  render={({ field: threshold }) => (
                    <ThresholdStepper value={threshold.value} onChange={threshold.onChange} />
                  )}
                />
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 text-body font-medium text-primary">{m.consequenceLegend}</legend>
                  {ANTI_CHEAT_CONSEQUENCES.map((consequence) => (
                    <label
                      key={consequence}
                      className="flex items-start gap-2 text-body text-primary pointer-coarse:min-h-11"
                    >
                      <input
                        type="radio"
                        value={consequence}
                        className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
                        {...form.register('consequence')}
                      />
                      <span>
                        <span className="font-medium">{m.consequence[consequence].label}</span>
                        <span className="block text-callout text-secondary">{m.consequence[consequence].help}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              </div>
            ) : (
              <p className="mt-2 text-callout text-secondary">{m.antiCheatOffHint}</p>
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
                className="mt-2 rounded-lg bg-warning-bg p-3 text-callout text-warning"
                data-testid="identity-unavailable"
              >
                {m.identityUnavailable}
              </p>
            )}
          </SettingSwitch>
        )}
      />
      <div className="mt-4 space-y-1 text-callout text-secondary">
        <p>{m.appliesNote}</p>
        <p>{m.pcaNote}</p>
        {updated && <p className="text-caption text-secondary">{m.updatedAt.replace('{date}', updated)}</p>}
      </div>
      <div className="mt-5 flex justify-end">
        <Button type="submit" disabled={!form.formState.isDirty} loading={save.isPending} loadingLabel={m.saving}>
          {m.save}
        </Button>
      </div>
    </form>
  );
}
