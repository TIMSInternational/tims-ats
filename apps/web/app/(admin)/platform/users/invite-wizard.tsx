'use client';

import { useState, useCallback } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Modal } from '../../../../components';
import { ROLES, parseCSV, autoMap, type Mode, type BulkStep, type ParsedRow } from './invite-wizard.helpers';
import { BulkMapStep, BulkPreviewStep, BulkResultStep } from './invite-wizard.steps';

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
    onSuccess: () => { toast(t.invitations.invitationSent, { type: 'success' }); onSuccess(); },
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
    if (!colMap.email) { toast(t.invitations.mapEmailColumn, { type: 'error' }); return; }
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
    <Modal title={t.invitations.inviteUsersTitle} onClose={onClose} maxWidth="max-w-2xl">
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
          <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.organizationRequired}</label>
          <input type="text" value={activeOrgSearch} onChange={(e) => { setActiveOrgSearch(e.target.value); setActiveOrgId(''); }} placeholder={t.invitations.searchOrganization} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
          {activeOrgSearch && !activeOrgId && orgs.data && (
            <div className="mt-1 bg-white border border-[#EDEDED] rounded-lg shadow-lg max-h-32 overflow-y-auto">
              {orgs.data.organizations.map((org) => (
                <button key={org.id} type="button" onClick={() => { setActiveOrgId(org.id); setActiveOrgSearch(org.name); }} className="w-full text-left px-3 py-2 text-sm hover:bg-[#F6F6F6] transition">
                  {org.name} <span className="text-[#8B8B8B] text-xs">({org.slug})</span>
                </button>
              ))}
            </div>
          )}
          {activeOrgId && <p className="text-[10px] text-green-600 mt-1">{t.invitations.organizationSelected}</p>}
        </div>
      )}

      {/* === SINGLE MODE === */}
      {mode === 'single' && (
        <form onSubmit={(e) => { e.preventDefault(); if (email && orgId) createSingle.mutate({ email, organizationId: orgId, roleSlug: roleSlug || undefined }); }} className="space-y-4">
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invitations.emailRequired}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" required />
          </div>
          <div>
            <label className="text-xs font-medium text-[#585858] mb-1 block">Rol</label>
            <select value={roleSlug} onChange={(e) => setRoleSlug(e.target.value)} className="w-full h-9 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
              <option value="">{t.invitations.selectRole}</option>
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
            <p className="text-sm text-[#585858] mb-1">{t.invitations.dragCsvHere}</p>
            <p className="text-xs text-[#8B8B8B] mb-3">{t.invitations.clickToSelect}</p>
            <label className="inline-block h-9 px-4 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition cursor-pointer leading-9">
              Seleccionar Archivo
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#EDEDED]" /></div>
            <div className="relative flex justify-center"><span className="px-3 bg-white text-xs text-[#8B8B8B]">{t.invitations.pasteDataDirectly}</span></div>
          </div>
          <textarea
            rows={4}
            placeholder={"email,nombre,apellido,rol\njuan@empresa.com,Juan,Perez,recruiter\nmaria@empresa.com,Maria,Lopez,hr_admin"}
            className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-xs font-mono text-[#585858] placeholder:text-[#BABABA] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none"
            onPaste={(e) => { const text = e.clipboardData.getData('text'); if (text.includes('\n') || text.includes('\t')) { e.preventDefault(); handlePaste(text); } }}
            onChange={(e) => { if (e.target.value.includes('\n')) handlePaste(e.target.value); }}
          />
          <div className="p-3 rounded-lg bg-blue-50 text-xs text-blue-700">
            <strong>{t.invitations.expectedFormat}</strong> CSV con columnas: email (requerido), nombre, apellido, rol. La primera fila debe ser el encabezado.
          </div>
        </div>
      )}

      {mode === 'bulk' && bulkStep === 'map' && (
        <BulkMapStep
          rawHeaders={rawHeaders}
          rawRows={rawRows}
          colMap={colMap}
          setColMap={setColMap}
          setBulkStep={setBulkStep}
          onConfirm={handleMapConfirm}
        />
      )}

      {mode === 'bulk' && bulkStep === 'preview' && (
        <BulkPreviewStep
          parsedUsers={parsedUsers}
          bulkOrgId={bulkOrgId}
          isPending={bulkInvite.isPending}
          setBulkStep={setBulkStep}
          onSubmit={handleBulkSubmit}
        />
      )}

      {mode === 'bulk' && bulkStep === 'result' && bulkResult && (
        <BulkResultStep bulkResult={bulkResult} onSuccess={onSuccess} />
      )}
    </Modal>
  );
}
