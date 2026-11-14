'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { Button, Select } from '../../../../../components';

/**
 * The vacancy's FIT role family. The choice is saved only on "Guardar": a native select fires change on every
 * arrow-key step in Firefox and Chrome on Windows, and each save re-weights FIT (accessibility.md › Speech).
 */
export function RoleFamilyCard({ vacancyId, roleFamily }: { vacancyId: string; roleFamily: string | null }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const profiles = trpc.fitEngine.listRoleFamilyWeightProfiles.useQuery();
  const saved = roleFamily ?? '';
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? saved;
  const changed = draft !== null && draft !== saved;

  const update = trpc.vacancy.updateRoleFamily.useMutation({
    onSuccess: () => {
      toast(t.fitWeights.roleFamilySaved, { type: 'success' });
      setDraft(null);
      utils.vacancy.getById.invalidate({ id: vacancyId });
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const save = () => {
    if (!changed) return;
    update.mutate({ vacancyId, roleFamily: value || null });
  };

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
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape' && changed) {
            e.preventDefault();
            setDraft(null);
          }
        }}
        disabled={update.isPending}
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
      {changed && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="tertiary" size="sm" onClick={() => setDraft(null)} disabled={update.isPending}>
            {t.common.cancel}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={save}
            loading={update.isPending}
            loadingLabel={t.common.saving}
          >
            {t.common.save}
          </Button>
        </div>
      )}
    </section>
  );
}
