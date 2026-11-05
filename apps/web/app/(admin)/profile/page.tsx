'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../components';
import { ProfileForm } from './profile-form';

// /profile — "Mi perfil" (audit finding D-16). Every staff role can fix their own name, job title, phone,
// language and time zone on top of the existing user.me / user.updateProfile procedures (own record only,
// strict field allowlist on the server). Linked from the sidebar profile menu.
export default function ProfilePage() {
  const { t } = useI18n();
  const me = trpc.user.me.useQuery(undefined, { retry: false });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-lg font-semibold text-[#1F114C]">{t.profile.title}</h1>
        <p className="mt-1 text-sm text-[#8B8B8B]">{t.profile.subtitle}</p>
      </header>
      <section className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] max-w-2xl" aria-label={t.profile.title}>
        {me.isLoading ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : me.isError || !me.data ? (
          <ErrorState message={t.profile.loadError} onRetry={() => void me.refetch()} />
        ) : (
          <ProfileForm profile={me.data} />
        )}
      </section>
    </div>
  );
}
