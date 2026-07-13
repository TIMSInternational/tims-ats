'use client';

import { trpc } from '../../../../../lib/trpc';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';

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
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3">{t.fitWeights.roleFamilyLabel}</h3>
      <select
        value={roleFamily ?? ''}
        onChange={(e) => update.mutate({ vacancyId, roleFamily: e.target.value || null })}
        disabled={update.isPending}
        className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40 disabled:bg-[#F6F6F6]"
      >
        <option value="">{t.fitWeights.roleFamilyNone}</option>
        {(profiles.data ?? []).filter((p) => p.name !== 'Default').map((p) => (
          <option key={p.id} value={p.name}>{p.name}</option>
        ))}
      </select>
    </div>
  );
}
