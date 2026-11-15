'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Select } from '../../../../../components';

/** The vacancy's FIT role family. Saved as soon as it changes, so leaving the page never loses a choice. */
export function RoleFamilyCard({ vacancyId, roleFamily }: { vacancyId: string; roleFamily: string | null }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const profiles = trpc.fitEngine.listRoleFamilyWeightProfiles.useQuery();

  const update = trpc.vacancy.updateRoleFamily.useMutation({
    onSuccess: () => {
      toast(t.fitWeights.roleFamilySaved, { type: 'success' });
      utils.vacancy.getById.invalidate({ id: vacancyId });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  return (
    <section
      aria-labelledby="vacancy-role-family-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <h2 id="vacancy-role-family-title" className="mb-1 text-heading font-semibold text-brand">
        {t.fitWeights.roleFamilyLabel}
      </h2>
      <p id="vacancy-role-family-help" className="mb-3 text-callout text-secondary">
        {t.vacancies.roleFamilyHelp}
      </p>
      <Select
        value={roleFamily ?? ''}
        onChange={(e) => update.mutate({ vacancyId, roleFamily: e.target.value || null })}
        disabled={update.isPending}
        aria-busy={update.isPending}
        aria-labelledby="vacancy-role-family-title"
        aria-describedby="vacancy-role-family-help"
      >
        <option value="">{t.fitWeights.roleFamilyNone}</option>
        {(profiles.data ?? [])
          .filter((p) => p.name !== 'Default')
          .map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}
            </option>
          ))}
      </Select>
    </section>
  );
}
