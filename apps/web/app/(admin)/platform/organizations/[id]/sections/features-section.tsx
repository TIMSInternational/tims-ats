'use client';

import { trpc } from '../../../../../../lib/trpc';
import { toast } from '../../../../../../lib/toast';
import { useI18n } from '../../../../../../lib/i18n';
import { EmptyState, ErrorState, Skeleton, Switch } from '../../../../../../components';

/** Flags every organization can have, even before a row exists in the database. */
const KNOWN_FLAGS = [
  'ai_cv_parser',
  'ai_vacancy_writer',
  'ai_candidate_screener',
  'ai_interview_questions',
  'ai_email_composer',
  'advanced_reports',
  'multi_language',
  'custom_pipelines',
  'sso_enabled',
  'api_access',
] as const;

export function FeaturesSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const { data: flagGroups, isLoading, isError, refetch } = trpc.platform.listAllFeatureFlags.useQuery();

  const updateFlag = trpc.platform.updateFeatureFlag.useMutation({
    onSuccess: () => {
      utils.platform.listAllFeatureFlags.invalidate();
      toast(t.featureFlags.updated, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || t.organizations.featureUpdateError, { type: 'error' });
    },
  });

  // Extract flags for this org
  const orgFlags: Array<{ key: string; enabled: boolean }> = [];
  const allKeys = new Set<string>();

  if (flagGroups) {
    for (const group of flagGroups) {
      allKeys.add(group.key);
      const entry = group.entries.find((e) => e.organization?.id === organizationId);
      orgFlags.push({ key: group.key, enabled: entry?.enabled ?? false });
    }
  }

  // Add common keys not yet in DB
  for (const key of KNOWN_FLAGS) {
    if (!allKeys.has(key)) {
      orgFlags.push({ key, enabled: false });
    }
  }

  const handleToggle = (key: string, enabled: boolean) => {
    updateFlag.mutate({ organizationId, key, enabled });
  };

  const descriptions: Record<string, string> = t.organizations.featureDescriptions;
  const CARD = 'rounded-xl bg-white shadow-card';

  return (
    <div className="space-y-4">
      <h2 className="text-subheading font-semibold text-primary">{t.organizations.tabFeatures}</h2>

      {isLoading ? (
        <div className={`${CARD} space-y-4 p-5`} aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div><Skeleton className="mb-1 h-4 w-40" /><Skeleton className="h-3 w-56" /></div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className={CARD}>
          <ErrorState onRetry={() => refetch()} />
        </div>
      ) : orgFlags.length === 0 ? (
        <div className={CARD}>
          <EmptyState title={t.featureFlags.noFlags} />
        </div>
      ) : (
        <ul className={`${CARD} divide-y divide-border`}>
          {orgFlags.map((flag) => {
            const titleId = `feature-${flag.key}-title`;
            return (
              <li key={flag.key} className="flex items-center justify-between gap-4 px-4 py-3 md:px-5">
                <div className="min-w-0">
                  <p id={titleId} className="text-body font-medium text-primary">{descriptions[flag.key] ?? t.featureFlags.customFlag}</p>
                  <p className="mt-0.5 break-all font-mono text-caption text-muted">{flag.key}</p>
                </div>
                <Switch
                  checked={flag.enabled}
                  labelledBy={titleId}
                  disabled={updateFlag.isPending}
                  onChange={(next) => handleToggle(flag.key, next)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
