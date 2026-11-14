'use client';

import { trpc } from '../../../lib/trpc';
import { useI18n } from '../../../lib/i18n';
import { ErrorState, Skeleton } from '../../../components';
import { PageHeader } from '../../../components/page-header';
import { ProfileForm } from './profile-form';

// /profile — "Mi perfil" (audit finding D-16). Every staff role can fix their own name, job title, phone,
// language and time zone on top of the existing user.me / user.updateProfile procedures (own record only,
// strict field allowlist on the server). Linked from the sidebar profile menu.
export default function ProfilePage() {
  const { t } = useI18n();
  const me = trpc.user.me.useQuery(undefined, { retry: false });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader title={t.profile.title} description={t.profile.subtitle} titleId="profile-title" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <section className="max-w-2xl rounded-xl bg-white p-5 shadow-card" aria-labelledby="profile-title">
          {me.isLoading ? (
            <div aria-busy="true">
              <span className="sr-only">{t.common.loadingContent}</span>
              <Skeleton className="h-64 w-full rounded-lg" />
            </div>
          ) : me.isError || !me.data ? (
            <ErrorState
              size="compact"
              message={t.profile.loadError}
              onRetry={() => void me.refetch()}
              error={me.error}
            />
          ) : (
            <ProfileForm profile={me.data} />
          )}
        </section>
      </div>
    </div>
  );
}
