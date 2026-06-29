'use client';

import { useI18n } from '../../../../lib/i18n';
import type { ParsedRow } from './invite-wizard.helpers';

interface BulkMapStepProps {
  rawHeaders: string[];
  rawRows: string[][];
  colMap: Record<string, string>;
  setColMap: (map: Record<string, string>) => void;
  setBulkStep: (step: 'upload') => void;
  onConfirm: () => void;
}

export function BulkMapStep({ rawHeaders, rawRows, colMap, setColMap, setBulkStep, onConfirm }: BulkMapStepProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={() => setBulkStep('upload')} className="text-xs text-[#1F114C] hover:underline">&larr; Volver</button>
        <h3 className="text-sm font-semibold text-[#333]">{t.users.mapColumns}</h3>
        <span className="text-xs text-[#8B8B8B]">{rawRows.length} filas detectadas</span>
      </div>
      <p className="text-xs text-[#8B8B8B]">{t.users.mapColumnsDesc}</p>
      <div className="grid grid-cols-2 gap-3">
        {['email', 'firstName', 'lastName', 'role'].map((field) => (
          <div key={field}>
            <label className="text-[10px] font-semibold text-[#8B8B8B] uppercase mb-1 block">
              {field === 'email' ? 'Email *' : field === 'firstName' ? 'Nombre' : field === 'lastName' ? 'Apellido' : 'Rol'}
            </label>
            <select
              value={colMap[field] || ''}
              onChange={(e) => setColMap({ ...colMap, [field]: e.target.value })}
              className={`w-full h-9 px-3 rounded-lg border text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 ${
                field === 'email' && !colMap[field] ? 'border-red-300 bg-red-50' : 'border-[#EDEDED]'
              }`}
            >
              <option value="">-- No mapear --</option>
              {rawHeaders.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
        ))}
      </div>
      {rawRows.length > 0 && (
        <div className="bg-[#F6F6F6] rounded-lg p-3 overflow-x-auto">
          <p className="text-[10px] font-semibold text-[#8B8B8B] mb-2">{t.users.previewFirst3}</p>
          <table className="text-xs w-full">
            <thead><tr className="border-b border-[#EDEDED]">{rawHeaders.map(h => <th key={h} className="px-2 py-1 text-left text-[#8B8B8B] font-medium">{h}</th>)}</tr></thead>
            <tbody>{rawRows.slice(0, 3).map((row, i) => <tr key={i} className="border-b border-[#EDEDED]">{row.map((c, j) => <td key={j} className="px-2 py-1 text-[#585858]">{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => setBulkStep('upload')} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">Atras</button>
        <button onClick={onConfirm} disabled={!colMap.email} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">Continuar</button>
      </div>
    </div>
  );
}

interface BulkPreviewStepProps {
  parsedUsers: ParsedRow[];
  bulkOrgId: string;
  isPending: boolean;
  setBulkStep: (step: 'map') => void;
  onSubmit: () => void;
}

export function BulkPreviewStep({ parsedUsers, bulkOrgId, isPending, setBulkStep, onSubmit }: BulkPreviewStepProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => setBulkStep('map')} className="text-xs text-[#1F114C] hover:underline">&larr; Volver</button>
          <h3 className="text-sm font-semibold text-[#333]">{t.users.confirmImport}</h3>
        </div>
        <span className="text-xs font-medium text-[#1F114C] bg-[#1F114C]/10 px-2 py-1 rounded">{parsedUsers.length} usuarios validos</span>
      </div>
      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-[#EDEDED]">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-white"><tr className="border-b border-[#EDEDED]">
            <th className="px-3 py-2 text-left text-[#8B8B8B] font-medium">Email</th>
            <th className="px-3 py-2 text-left text-[#8B8B8B] font-medium">Nombre</th>
            <th className="px-3 py-2 text-left text-[#8B8B8B] font-medium">Rol</th>
          </tr></thead>
          <tbody>
            {parsedUsers.map((u, i) => (
              <tr key={i} className="border-b border-[#F6F6F6]">
                <td className="px-3 py-2 text-[#333]">{u.email}</td>
                <td className="px-3 py-2 text-[#585858]">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '-'}</td>
                <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-gray-100 text-gray-600">{u.role || 'employee'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button onClick={() => setBulkStep('map')} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">Atras</button>
        <button onClick={onSubmit} disabled={!bulkOrgId || isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">
          {isPending ? 'Importando...' : `Invitar ${parsedUsers.length} Usuarios`}
        </button>
      </div>
    </div>
  );
}

interface BulkResultStepProps {
  bulkResult: { sent: number; duplicates: number; errors: number };
  onSuccess: () => void;
}

export function BulkResultStep({ bulkResult, onSuccess }: BulkResultStepProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 text-center py-4">
      <svg className="w-14 h-14 mx-auto text-green-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
      <h3 className="text-lg font-semibold text-[#333]">{t.users.importComplete}</h3>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 rounded-lg p-3">
          <p className="text-2xl font-bold text-green-600">{bulkResult.sent}</p>
          <p className="text-[10px] text-green-700">Enviadas</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-3">
          <p className="text-2xl font-bold text-amber-600">{bulkResult.duplicates}</p>
          <p className="text-[10px] text-amber-700">Duplicadas</p>
        </div>
        <div className="bg-red-50 rounded-lg p-3">
          <p className="text-2xl font-bold text-[#DD0C15]">{bulkResult.errors}</p>
          <p className="text-[10px] text-red-700">Errores</p>
        </div>
      </div>
      <button onClick={() => { onSuccess(); }} className="h-9 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition">
        {t.common.close}
      </button>
    </div>
  );
}
