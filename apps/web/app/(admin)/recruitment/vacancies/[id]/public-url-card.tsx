'use client';

import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useCan } from '../../../../../lib/permissions';
import { buildPublicVacancyUrl, resolvePublicOrigin } from '../../../../../lib/public-vacancy-url';

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
    onError: (err) => { toast(err.message, { type: 'error' }); },
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
    <section aria-labelledby="public-url-title" className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 id="public-url-title" className="text-[14px] font-semibold text-[#1F114C] mb-1">{v.publicUrlTitle}</h3>
      {vacancyStatus === 'published' ? (
        <>
          <p className="text-[12px] text-[#8B8B8B] mb-3">{v.publicUrlDesc}</p>
          {url ? (
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label={v.publicUrlLabel}
                data-testid="public-vacancy-url"
                onFocus={(e) => e.currentTarget.select()}
                className="flex-1 min-w-0 h-9 rounded-lg border border-[#EDEDED] bg-[#F6F6F6] px-3 text-[12px] text-[#333]"
              />
              <button
                type="button"
                onClick={copy}
                className="h-9 shrink-0 rounded-lg bg-[#1F114C] px-4 text-[12px] font-medium text-white hover:bg-[#2a1866] transition"
              >
                {v.copyLink}
              </button>
            </div>
          ) : session.isLoading ? (
            <div className="h-9 w-full rounded-lg bg-[#ECECEC] animate-pulse" />
          ) : (
            <p role="alert" className="text-[12px] text-[#DD0C15]">{v.publicUrlUnavailable}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-[12px] text-[#8B8B8B] mb-3">{v.notPublishedDesc}</p>
          {can('vacancy', 'publish') && (
            <button
              type="button"
              onClick={() => publish.mutate({ vacancyId, channelName: v.channelTypeInternal, channelType: 'internal' })}
              disabled={publish.isPending}
              className="h-9 rounded-lg bg-[#DD0C15] px-4 text-[12px] font-medium text-white hover:bg-[#c00b13] transition disabled:opacity-50"
            >
              {publish.isPending ? v.publishing : v.publishToPortal}
            </button>
          )}
        </>
      )}
    </section>
  );
}
