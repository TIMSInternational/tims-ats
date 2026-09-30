'use client';

import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Skeleton } from '../../../../components/skeleton';
import { ErrorState } from '../../../../components/error-state';
import { useCreateTenantInvitation, useTenantInvitationRoles } from '../../../../lib/platform-api/tenant-invitations';
import { invitationErrorMessage } from './invitation-error-message';

const INPUT_CLS =
  'w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm bg-white focus:outline-none focus:border-[#1F114C]';

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
    return <ErrorState message={invitationErrorMessage(roles.error, 'read', m)} onRetry={() => void roles.refetch()} />;

  const available = roles.data ?? [];
  if (available.length === 0) return <p className="text-sm text-[#8B8B8B]">{m.rolesEmpty}</p>;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => create.mutate(values))}
      className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-start"
    >
      <div>
        <label htmlFor="team-invite-email" className="block text-xs font-medium text-[#585858] mb-1.5">
          {m.emailLabel}
        </label>
        <input
          id="team-invite-email"
          type="email"
          maxLength={254}
          autoComplete="off"
          placeholder={m.emailPlaceholder}
          aria-invalid={errors.email ? true : undefined}
          className={INPUT_CLS}
          {...form.register('email')}
        />
        {errors.email && <p className="mt-1 text-xs text-[#DD0C15]">{errors.email.message}</p>}
      </div>
      <div>
        <label htmlFor="team-invite-role" className="block text-xs font-medium text-[#585858] mb-1.5">
          {m.roleLabel}
        </label>
        <select id="team-invite-role" className={INPUT_CLS} {...form.register('roleSlug')}>
          <option value="">{m.rolePlaceholder}</option>
          {available.map((role) => (
            <option key={role.slug} value={role.slug}>
              {role.name}
            </option>
          ))}
        </select>
        {errors.roleSlug && <p className="mt-1 text-xs text-[#DD0C15]">{errors.roleSlug.message}</p>}
      </div>
      <button
        type="submit"
        disabled={create.isPending}
        className="h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50 md:mt-6"
      >
        {create.isPending ? m.inviting : m.inviteSubmit}
      </button>
    </form>
  );
}
