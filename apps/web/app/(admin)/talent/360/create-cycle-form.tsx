'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';

interface CreateCycleFormProps {
  onClose: () => void;
}

export function CreateCycleForm({ onClose }: CreateCycleFormProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const create = trpc.evaluation360.createCycle.useMutation({
    onSuccess: () => {
      toast(t.evaluation360.cycleCreated, { type: 'success' });
      // Refresh listCycles from BOTH read paths: the tRPC cache and — when the C# read cutover is
      // live (NEXT_PUBLIC_EVALUATION360_READ_VIA_CSHARP) — the platform-api query key, which the
      // tRPC invalidate does not reach. Harmless (no-op key) while dark.
      utils.evaluation360.listCycles.invalidate();
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'evaluation360', 'cycles'] });
      setName('');
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
      <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.evaluation360.cycleNameLabel}</label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 200))}
        placeholder={t.evaluation360.cycleNamePlaceholder}
        disabled={create.isPending}
        className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] mb-4 focus:outline-none focus:border-[#1F114C]/40 disabled:opacity-50"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          disabled={create.isPending}
          className="h-9 px-4 rounded-lg text-[12px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition disabled:opacity-50"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={() => create.mutate({ name: name.trim() })}
          disabled={create.isPending || name.trim().length === 0}
          className="h-9 px-4 rounded-lg text-[12px] bg-[#DD0C15] text-white font-medium hover:bg-red-700 transition disabled:opacity-50"
        >
          {create.isPending ? t.common.saving : t.evaluation360.saveButton}
        </button>
      </div>
    </div>
  );
}
