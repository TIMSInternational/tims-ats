'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import type { AiAgentItem } from '../../../../lib/trpc-types';

export function AgentEditDrawer({ agent, onClose, onSuccess }: { agent: AiAgentItem; onClose: () => void; onSuccess: () => void }) {
  const [editModel, setEditModel] = useState(agent.model);
  const [editCache, setEditCache] = useState(agent.cacheTtlSeconds);
  const [editBatch, setEditBatch] = useState(agent.batchEligible);
  const [editStatus, setEditStatus] = useState(agent.status);
  const [editDescription, setEditDescription] = useState(agent.description);

  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => {
      toast('Agente IA actualizado', { type: 'success' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || 'Error al actualizar agente', { type: 'error' }); },
  });

  function handleSaveEdit() {
    updateAgent.mutate({
      id: agent.id,
      model: editModel,
      cacheTtlSeconds: editCache,
      batchEligible: editBatch,
      status: editStatus,
      description: editDescription,
    });
  }

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
          {/* Status */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Estado</label>
            <select
              value={editStatus}
              onChange={e => setEditStatus(e.target.value)}
              className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
            >
              <option value="active">Activo</option>
              <option value="stub">Stub</option>
              <option value="disabled">Deshabilitado</option>
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Modelo</label>
            <select
              value={editModel}
              onChange={e => setEditModel(e.target.value)}
              className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
            >
              <option value="haiku">Claude Haiku</option>
              <option value="sonnet">Claude Sonnet</option>
            </select>
          </div>

          {/* Cache TTL */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Cache TTL (segundos)</label>
            <input
              type="number"
              min={0}
              value={editCache}
              onChange={e => setEditCache(Number(e.target.value))}
              className="w-full h-9 px-3 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30"
            />
          </div>

          {/* Batch */}
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-semibold text-[#8B8B8B] uppercase">Batch Eligible</label>
            <button
              onClick={() => setEditBatch(!editBatch)}
              className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${editBatch ? 'bg-[#1F114C]' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${editBatch ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Description */}
          <div>
            <label className="block text-[11px] font-semibold text-[#8B8B8B] uppercase mb-1.5">Descripcion</label>
            <textarea
              value={editDescription}
              onChange={e => setEditDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-[12px] border border-[#EDEDED] rounded-lg bg-white text-[#585858] focus:outline-none focus:ring-1 focus:ring-[#1F114C]/30 resize-none"
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#EDEDED] flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-9 px-4 text-[12px] font-medium text-[#585858] bg-[#F5F5F5] rounded-lg hover:bg-[#EDEDED] transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSaveEdit}
            disabled={updateAgent.isPending}
            className="h-9 px-4 text-[12px] font-medium text-white bg-[#1F114C] rounded-lg hover:bg-[#1F114C]/90 disabled:opacity-50 transition-colors"
          >
            {updateAgent.isPending ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
