'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { AiAgentItem } from '../../../../lib/trpc-types';

export function AgentEditDrawer({ agent, onClose, onSuccess }: { agent: AiAgentItem; onClose: () => void; onSuccess: () => void }) {
  const { t } = useI18n();
  const [editModel, setEditModel] = useState<'haiku' | 'sonnet'>(agent.model as 'haiku' | 'sonnet');
  const [editCache, setEditCache] = useState(agent.cacheTtlSeconds);
  const [editBatch, setEditBatch] = useState(agent.batchEligible);
  const [editStatus, setEditStatus] = useState<'active' | 'stub' | 'disabled'>(agent.status as 'active' | 'stub' | 'disabled');
  const [editDescription, setEditDescription] = useState(agent.description);

  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => { toast(t.aiAgents.updated, { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[#EDEDED] flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-semibold text-[#1F114C]">{agent.name}</h3>
            <p className="text-[11px] text-[#8B8B8B]">{agent.slug}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#8B8B8B] hover:bg-[#F5F5F5]">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.statusLabel}</label>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value as typeof editStatus)} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30">
              <option value="active">{t.aiAgents.statusActive}</option>
              <option value="stub">{t.aiAgents.statusStub}</option>
              <option value="disabled">{t.aiAgents.statusDisabled}</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.modelLabel}</label>
            <select value={editModel} onChange={e => setEditModel(e.target.value as typeof editModel)} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30">
              <option value="haiku">Claude Haiku</option>
              <option value="sonnet">Claude Sonnet</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.cacheTtlLabel}</label>
            <input type="number" min={0} value={editCache} onChange={e => setEditCache(Number(e.target.value))} className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30" />
          </div>
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-[#8B8B8B] uppercase">{t.aiAgents.batchLabel}</label>
            <button onClick={() => setEditBatch(!editBatch)} className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${editBatch ? 'bg-[#1F114C]' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${editBatch ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">{t.aiAgents.descriptionLabel}</label>
            <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} className="w-full px-3 py-2 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30 resize-none" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-[#EDEDED] flex items-center justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 text-[12px] font-medium text-[#585858] bg-[#F5F5F5] rounded-lg hover:bg-[#EDEDED] transition-colors">{t.common.cancel}</button>
          <button
            onClick={() => updateAgent.mutate({ id: agent.id, model: editModel, cacheTtlSeconds: editCache, batchEligible: editBatch, status: editStatus, description: editDescription })}
            disabled={updateAgent.isPending}
            className="h-9 px-4 text-[12px] font-medium text-white bg-[#1F114C] rounded-lg hover:bg-[#1F114C]/90 disabled:opacity-50 transition-colors"
          >
            {updateAgent.isPending ? t.common.saving : t.aiAgents.saveChanges}
          </button>
        </div>
      </div>
    </div>
  );
}
