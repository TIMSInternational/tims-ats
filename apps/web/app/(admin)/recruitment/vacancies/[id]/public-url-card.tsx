'use client';

import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useCan } from '../../../../../lib/permissions';
import { buildPublicVacancyUrl, resolvePublicOrigin } from '../../../../../lib/public-vacancy-url';
import { Button, Skeleton } from '../../../../../components';

interface PublicUrlCardProps {
  vacancyId: string;
  vacancyStatus: string;
}

// RH-10: surfaces the public careers link (published) or a one-click "publish to portal" (approved),
// instead of hiding publishing behind Channels → + Add channel. Publishing reuses the same
// vacancy.publish mutation the channels card uses, with the internal-portal channel type.
export function PublicUrlCard({ vacancyId, vacancyStatus }: PublicUrlCardProps) {
  const { t } = useI18n();
  const v = t.vacancies;
  const can = useCan();
  const utils = trpc.useUtils();
  const session = trpc.auth.getSessionInfo.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const publish = trpc.vacancy.publish.useMutation({
    onSuccess: () => {
      utils.vacancy.getById.invalidate({ id: vacancyId });
      utils.vacancy.list.invalidate();
      toast(v.publishedToPortal, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  if (vacancyStatus !== 'published' && vacancyStatus !== 'approved') return null;

  const orgSlug = session.data?.organization?.slug ?? null;
  const url = orgSlug ? buildPublicVacancyUrl(resolvePublicOrigin(), orgSlug, vacancyId) : null;

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast(v.linkCopied, { type: 'success' });
    } catch {
      toast(v.copyFailed, { type: 'error' });
    }
  };

  return (
    <section aria-labelledby="public-url-title" className="rounded-xl border border-border bg-white p-5 shadow-card">
      <h2 id="public-url-title" className="mb-1 text-heading font-semibold text-brand">
        {v.publicUrlTitle}
      </h2>
      {vacancyStatus === 'published' ? (
        <>
          <p className="mb-3 text-callout text-secondary">{v.publicUrlDesc}</p>
          {url ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                readOnly
                value={url}
                aria-label={v.publicUrlLabel}
                data-testid="public-vacancy-url"
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-lg border border-field-border bg-surface px-3 text-base text-primary sm:text-body pointer-coarse:h-11"
              />
              <Button variant="secondary" onClick={copy} className="shrink-0">
                {v.copyLink}
              </Button>
            </div>
          ) : session.isLoading ? (
            <Skeleton className="h-9 w-full rounded-lg" />
          ) : (
            <p role="alert" className="text-callout text-danger">
              {v.publicUrlUnavailable}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="mb-3 text-callout text-secondary">{v.notPublishedDesc}</p>
          {/* An approved vacancy's one primary action: the page header holds none for this status. */}
          {can('vacancy', 'publish') && (
            <Button
              onClick={() => publish.mutate({ vacancyId, channelName: v.channelTypeInternal, channelType: 'internal' })}
              loading={publish.isPending}
              loadingLabel={v.publishing}
            >
              {v.publishToPortal}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
