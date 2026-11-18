'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Skeleton } from '../../../../components/skeleton';
import { ErrorState } from '../../../../components/error-state';
import { Button } from '../../../../components/button';
import { Field } from '../../../../components/field';
import { TextInput } from '../../../../components/text-input';
import { Select } from '../../../../components/select';
import { useCreateTenantInvitation, useTenantInvitationRoles } from '../../../../lib/platform-api/tenant-invitations';
import { roleOptions } from '../../../../lib/role-labels';
import { invitationErrorMessage } from './invitation-error-message';

export function InviteForm() {
  const { t } = useI18n();
  const m = t.teamSettings;
  const roles = useTenantInvitationRoles(true);

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().trim().max(254, m.emailInvalid).email(m.emailInvalid),
        roleSlug: z.string().min(1, m.roleRequired).max(50, m.roleRequired),
      }),
    [m.emailInvalid, m.roleRequired],
  );
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', roleSlug: '' } });
  const { errors } = form.formState;

  const create = useCreateTenantInvitation({
    onSuccess: (delivery) => {
      form.reset({ email: '', roleSlug: form.getValues('roleSlug') });
      if (delivery === 'accepted') toast(m.invitedAccepted, { type: 'success' });
      else toast(m.invitedUnconfirmed, { type: 'warning', duration: 8000 });
    },
    onError: (error) => toast(invitationErrorMessage(error, 'create', m), { type: 'error' }),
  });

  if (roles.isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (roles.isError)
    return (
      <ErrorState
        size="compact"
        message={invitationErrorMessage(roles.error, 'read', m)}
        onRetry={() => void roles.refetch()}
        error={roles.error}
      />
    );

  // Labels come from the shared role map (never the seeded DB name) and the launch scope hides the roles the
  // pilot does not use (PILOT_HIDDEN_ROLE_SLUGS). The API still enforces what this caller may grant.
  const available = roleOptions(roles.data ?? [], t.roles);
  if (available.length === 0) return <p className="text-body text-secondary">{m.rolesEmpty}</p>;
  const selectedRole = form.watch('roleSlug');
  const roleHint = Object.prototype.hasOwnProperty.call(m.roleDescriptions, selectedRole)
    ? m.roleDescriptions[selectedRole as keyof typeof m.roleDescriptions]
    : null;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
      className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-start"
    >
      {/* Field wires label, help and error (aria-describedby + role=alert) to each control (settings-16).
          Both are required: aria-required says so without changing the visible label text. */}
      <Field id="team-invite-email" label={m.emailLabel} error={errors.email?.message}>
        <TextInput
          type="email"
          aria-required="true"
          maxLength={254}
          autoComplete="off"
          placeholder={m.emailPlaceholder}
          {...form.register('email')}
        />
      </Field>
      <Field id="team-invite-role" label={m.roleLabel} help={roleHint} error={errors.roleSlug?.message}>
        <Select aria-required="true" {...form.register('roleSlug')}>
          <option value="">{m.rolePlaceholder}</option>
          {available.map((role) => (
            <option key={role.slug} value={role.slug}>
              {role.label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" loading={create.isPending} loadingLabel={m.inviting} className="md:mt-6">
        {m.inviteSubmit}
      </Button>
    </form>
  );
}
