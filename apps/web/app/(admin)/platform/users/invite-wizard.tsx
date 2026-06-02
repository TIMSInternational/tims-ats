'use client';

import { useState, useCallback } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';

type Mode = 'single' | 'bulk';
type BulkStep = 'upload' | 'map' | 'preview' | 'result';

interface ParsedRow { email: string; firstName?: string; lastName?: string; role?: string }

const ROLES = [
  { slug: 'super_admin', label: 'Super Admin' },
  { slug: 'hr_admin', label: 'HR Admin' },
  { slug: 'recruiter', label: 'Recruiter' },
  { slug: 'leader', label: 'Leader' },
  { slug: 'employee', label: 'Employee' },
];

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim()));
  return { headers, rows };
}

function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const lower = headers.map(h => h.toLowerCase());
  const patterns: [string, string[]][] = [
    ['email', ['email', 'correo', 'e-mail', 'mail']],
    ['firstName', ['first', 'nombre', 'firstname', 'first_name', 'first name']],
    ['lastName', ['last', 'apellido', 'lastname', 'last_name', 'last name', 'surname']],
    ['role', ['role', 'rol', 'cargo', 'position', 'puesto']],
  ];
  for (const [field, keywords] of patterns) {
    const idx = lower.findIndex(h => keywords.some(k => h.includes(k)));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}

interface InviteWizardProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function InviteWizard({ onClose, onSuccess }: InviteWizardProps) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>('single');

  // Single invite state
  const [email, setEmail] = useState('');
  const [orgId, setOrgId] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [roleSlug, setRoleSlug] = useState('');

  // Bulk state
  const [bulkStep, setBulkStep] = useState<BulkStep>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [parsedUsers, setParsedUsers] = useState<ParsedRow[]>([]);
  const [bulkOrgId, setBulkOrgId] = useState('');
  const [bulkOrgSearch, setBulkOrgSearch] = useState('');
  const [bulkResult, setBulkResult] = useState<{ sent: number; duplicates: number; errors: number } | null>(null);

  const orgs = trpc.platform.listOrganizations.useQuery({ search: (mode === 'single' ? orgSearch : bulkOrgSearch) || undefined, limit: 10, page: 0 });
  const createSingle = trpc.platform.createUserInvitation.useMutation({
    onSuccess: () => { toast('Invitacion enviada', { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });
  const bulkInvite = trpc.platform.bulkInviteUsers.useMutation({
    onSuccess: (data) => {
      setBulkResult(data.summary);
      setBulkStep('result');
    },
    onError: (err) => { toast(err.message, { type: 'error' }); },
  });

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCSV(text);
      setRawHeaders(headers);
      setRawRows(rows);
      setColMap(autoMap(headers));
      setBulkStep('map');
    };
    reader.readAsText(file);
  }, []);

  const handlePaste = useCallback((text: string) => {
    if (!text.trim()) return;
    const { headers, rows } = parseCSV(text);
    setRawHeaders(headers);
    setRawRows(rows);
    setColMap(autoMap(headers));
    setBulkStep('map');
  }, []);

  const handleMapConfirm = () => {
    if (!colMap.email) { toast('Mapea la columna de email', { type: 'error' }); return; }
    const users: ParsedRow[] = rawRows.map(row => {
      const get = (field: string) => {
        const header = colMap[field];
        if (!header) return undefined;
        const idx = rawHeaders.indexOf(header);
        return idx >= 0 ? row[idx] : undefined;
      };
      return {
        email: get('email') || '',
        firstName: get('firstName'),
        lastName: get('lastName'),
        role: get('role'),
      };
    }).filter(u => u.email && u.email.includes('@'));
    setParsedUsers(users);
    setBulkStep('preview');
  };

  const handleBulkSubmit = () => {
    if (!bulkOrgId || parsedUsers.length === 0) return;
    bulkInvite.mutate({
      organizationId: bulkOrgId,
      users: parsedUsers.map(u => ({
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roleSlug: u.role || undefined,
      })),
    });
  };

  const activeOrgId = mode === 'single' ? orgId : bulkOrgId;
  const activeOrgSearch = mode === 'single' ? orgSearch : bulkOrgSearch;
  const setActiveOrgId = mode === 'single' ? setOrgId : setBulkOrgId;
  const setActiveOrgSearch = mode === 'single' ? setOrgSearch : setBulkOrgSearch;

  return (
    <Modal title="Invitar Usuarios" onClose={onClose} maxWidth="max-w-2xl">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-[#F6F6F6] rounded-lg mb-5">
        <button onClick={() => setMode('single')} className={`flex-1 py-2 text-xs font-medium rounded-md transition ${mode === 'single' ? 'bg-white shadow-sm text-[#1F114C]' : 'text-[#8B8B8B]'}`}>
          Individual
        </button>
        <button onClick={() => { setMode('bulk'); setBulkStep('upload'); }} className={`flex-1 py-2 text-xs font-medium rounded-md transition ${mode === 'bulk' ? 'bg-white shadow-sm text-[#1F114C]' : 'text-[#8B8B8B]'}`}>
          CSV / Masivo
        </button>
      </div>

      {/* Org selector (shared) */}
      {((mode === 'single') || (mode === 'bulk' && bulkStep === 'upload')) && (
        <div className="mb-4">
          <label className="text-xs font-medium text-[#585858] mb-1 block">Organizacion *</label>
          <input type="text" value={activeOrgSearch} onChange={(e) => { setActiveOrgSearch(e.target.value); setActiveOrgId(''); }} placeholder="Buscar organizacion..." className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          {activeOrgSearch && !activeOrgId && orgs.data && (
            <div className="mt-1 bg-white border border-[#EDEDED] rounded-lg shadow-lg max-h-32 overflow-y-auto">
              {orgs.data.organizations.map((org) => (
                <button key={org.id} type="button" onClick={() => { setActiveOrgId(org.id); setActiveOrgSearch(org.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F6F6F6] transition">
                  {org.name} <span className="text-[#8B8B8B] text-xs">({org.slug})</span>
                </button>
              ))}
            </div>
          )}
          {activeOrgId && <p className="text-[10px] text-green-600 mt-1">Organizacion seleccionada</p>}
        </div>
      )}

      {/* === SINGLE MODE === */}
      {mode === 'single' && (
        <form onSubmit={(e) => { e.preventDefault(); if (email && orgId) createSingle.mutate({ email, organizationId: orgId, roleSlug: roleSlug || undefined }); }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Email *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Rol</label>
            <select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="">Seleccionar rol...</option>
              {ROLES.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
            <button type="submit" disabled={!email || !orgId || createSingle.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">
              {createSingle.isPending ? t.common.saving : 'Enviar Invitacion'}
            </button>
          </div>
        </form>
      )}

      {/* === BULK MODE === */}
      {mode === 'bulk' && bulkStep === 'upload' && (
        <div className="space-y-4">
          <div className="border-2 border-dashed border-[#EDEDED] rounded-xl p-8 text-center hover:border-[#1F114C]/30 transition">
            <svg className="w-10 h-10 mx-auto mb-3 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            <p className="text-sm text-[#585858] mb-1">Arrastra un archivo CSV o Excel aqui</p>
            <p className="text-xs text-[#8B8B8B] mb-3">o haz clic para seleccionar</p>
            <label className="inline-block h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition cursor-pointer leading-9">
              Seleccionar Archivo
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#EDEDED]" /></div>
            <div className="relative flex justify-center"><span className="px-3 bg-white text-xs text-[#8B8B8B]">o pega datos directamente</span></div>
          </div>
          <textarea
            rows={4}
            placeholder={"email,nombre,apellido,rol\njuan@empresa.com,Juan,Perez,recruiter\nmaria@empresa.com,Maria,Lopez,hr_admin"}
            className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-xs font-mono text-[#585858] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none"
            onPaste={(e) => { const text = e.clipboardData.getData('text'); if (text.includes('\n') || text.includes('\t')) { e.preventDefault(); handlePaste(text); } }}
            onChange={(e) => { if (e.target.value.includes('\n')) handlePaste(e.target.value); }}
          />
          <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-700">
            <strong>Formato esperado:</strong> CSV con columnas: email (requerido), nombre, apellido, rol. La primera fila debe ser el encabezado.
          </div>
        </div>
      )}

      {mode === 'bulk' && bulkStep === 'map' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setBulkStep('upload')} className="text-xs text-[#1F114C] hover:underline">&larr; Volver</button>
            <h3 className="text-sm font-semibold text-[#333]">Mapear Columnas</h3>
            <span className="text-xs text-[#8B8B8B]">{rawRows.length} filas detectadas</span>
          </div>
          <p className="text-xs text-[#8B8B8B]">Asigna cada columna de tu archivo al campo correspondiente.</p>
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
              <p className="text-[10px] font-semibold text-[#8B8B8B] mb-2">Vista previa (primeras 3 filas)</p>
              <table className="text-xs w-full">
                <thead><tr className="border-b border-[#EDEDED]">{rawHeaders.map(h => <th key={h} className="px-2 py-1 text-left text-[#8B8B8B] font-medium">{h}</th>)}</tr></thead>
                <tbody>{rawRows.slice(0, 3).map((row, i) => <tr key={i} className="border-b border-[#EDEDED]">{row.map((c, j) => <td key={j} className="px-2 py-1 text-[#585858]">{c}</td>)}</tr>)}</tbody>
              </table>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setBulkStep('upload')} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">Atras</button>
            <button onClick={handleMapConfirm} disabled={!colMap.email} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">Continuar</button>
          </div>
        </div>
      )}

      {mode === 'bulk' && bulkStep === 'preview' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button onClick={() => setBulkStep('map')} className="text-xs text-[#1F114C] hover:underline">&larr; Volver</button>
              <h3 className="text-sm font-semibold text-[#333]">Confirmar Importacion</h3>
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
            <button onClick={handleBulkSubmit} disabled={!bulkOrgId || bulkInvite.isPending} className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50">
              {bulkInvite.isPending ? 'Importando...' : `Invitar ${parsedUsers.length} Usuarios`}
            </button>
          </div>
        </div>
      )}

      {mode === 'bulk' && bulkStep === 'result' && bulkResult && (
        <div className="space-y-4 text-center py-4">
          <svg className="w-14 h-14 mx-auto text-green-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <h3 className="text-lg font-semibold text-[#333]">Importacion Completa</h3>
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
      )}
    </Modal>
  );
}
