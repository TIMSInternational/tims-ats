'use client';

import { useState, useCallback } from 'react';
import { useUserInvitationRoles } from '../../../../lib/platform-api/user-invitation-roles';
import { useUserInvitationCreate } from '../../../../lib/platform-api/user-invitation-create';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  ErrorState,
  FIELD_ERROR_CLASSES,
  FIELD_LABEL_CLASSES,
  Modal,
  SegmentedControl,
  buttonClasses,
  inputClasses,
  selectClasses,
  textareaClasses,
} from '../../../../components';
import { isInviteRoleValid, rowsMissingRole } from '../../../../lib/invitations/invite-role';
import { parseCSV, autoMap, type Mode, type BulkStep, type ParsedRow } from './invite-wizard.helpers';
import { useBulkInvitationCreate, type BulkInvitationResponse } from '../../../../lib/platform-api/bulk-invitation-create';
import { BulkResultStep } from './bulk-result-step';
import { BulkMapStep, BulkPreviewStep } from './invite-wizard.steps';

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
  const [roleTouched, setRoleTouched] = useState(false);
  const roleError = roleTouched && !isInviteRoleValid(roleSlug);

  // Bulk state
  const [bulkStep, setBulkStep] = useState<BulkStep>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMap, setColMap] = useState<Record<string, string>>({});
  const [parsedUsers, setParsedUsers] = useState<ParsedRow[]>([]);
  const [bulkOrgId, setBulkOrgId] = useState('');
  const [bulkOrgSearch, setBulkOrgSearch] = useState('');
  const [bulkResult, setBulkResult] = useState<BulkInvitationResponse | null>(null);

  const orgs = trpc.platform.listOrganizations.useQuery({ search: (mode === 'single' ? orgSearch : bulkOrgSearch) || undefined, limit: 10, page: 0 });
  const invitationRoles = useUserInvitationRoles(orgId);

  const createSingle = useUserInvitationCreate({
    onSuccess: (delivery) => {
      toast(delivery === 'accepted' ? t.invitations.invitationSent : t.invitations.userInviteDeliveryUnconfirmed,
        { type: delivery === 'accepted' ? 'success' : 'warning' });
      onSuccess();
    },
    onError: (err) => { toast(err.message || t.invitations.creationFailed, { type: 'error' }); },
  });
  const bulkInvite = useBulkInvitationCreate({
    onSuccess: (data) => {
      setBulkResult(data);
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
    // A row without a role would silently become `employee` server-side — refuse the batch instead.
    const missing = rowsMissingRole(parsedUsers);
    if (missing.length > 0) {
      toast(`${t.invitations.bulkRowsMissingRole} ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`, { type: 'error', duration: 8000 });
      return;
    }
    bulkInvite.mutate({
      organizationId: bulkOrgId,
      users: parsedUsers.map(u => ({
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        roleSlug: u.role?.trim(),
      })),
    });
  };

  const activeOrgId = mode === 'single' ? orgId : bulkOrgId;
  const activeOrgSearch = mode === 'single' ? orgSearch : bulkOrgSearch;
  const setActiveOrgId = mode === 'single' ? setOrgId : setBulkOrgId;
  const setActiveOrgSearch = mode === 'single' ? setOrgSearch : setBulkOrgSearch;

  const inv = t.invitations;
  const modeOptions = [
    { value: 'single' as const, label: inv.singleMode },
    { value: 'bulk' as const, label: inv.bulkMode },
  ];
  const orgResults = orgs.data?.organizations ?? [];

  return (
    <Modal title={inv.inviteUserTitle} onClose={onClose} size="lg" dirty={Boolean(email) || parsedUsers.length > 0}>
      {/* Mode switch: the same task, one person or a file (segmented-controls.md) */}
      <SegmentedControl
        label={inv.modeLabel}
        options={modeOptions}
        value={mode}
        fullWidth
        className="mb-5"
        onChange={(next) => {
          setMode(next);
          if (next === 'bulk') setBulkStep('upload');
        }}
      />

      {/* Org selector (shared) */}
      {((mode === 'single') || (mode === 'bulk' && bulkStep === 'upload')) && (
        <div className="mb-4">
          <label htmlFor="invite-wizard-org" className={FIELD_LABEL_CLASSES}>{inv.organizationRequired}</label>
          <input
            id="invite-wizard-org"
            type="text"
            autoComplete="off"
            value={activeOrgSearch}
            onChange={(e) => { setActiveOrgSearch(e.target.value); setActiveOrgId(''); setRoleSlug(''); }}
            placeholder={inv.searchOrganization}
            aria-describedby="invite-wizard-org-status"
            className={inputClasses('md')}
          />
          {activeOrgSearch && !activeOrgId && orgs.isError && (
            <ErrorState size="inline" className="mt-2" onRetry={() => orgs.refetch()} error={orgs.error} />
          )}
          {activeOrgSearch && !activeOrgId && orgs.data && orgResults.length > 0 && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded-lg border border-border bg-white shadow-popover">
              {orgResults.map((org) => (
                <button key={org.id} type="button" onClick={() => { setActiveOrgId(org.id); setActiveOrgSearch(org.name); setRoleSlug(''); }} className="w-full px-3 py-2 text-left text-body text-primary transition-colors hover:bg-surface pointer-coarse:min-h-11">
                  {org.name} <span className="text-callout text-secondary">({org.slug})</span>
                </button>
              ))}
            </div>
          )}
          <p id="invite-wizard-org-status" role="status" className="mt-1.5 text-callout">
            {activeOrgId ? (
              <span className="font-medium text-success">{formatMessage(inv.orgChosen, { name: activeOrgSearch })}</span>
            ) : activeOrgSearch && orgs.data && orgResults.length === 0 ? (
              <span className="text-secondary">{t.common.noResults}</span>
            ) : null}
          </p>
        </div>
      )}

      {/* === SINGLE MODE === */}
      {mode === 'single' && (
        <form onSubmit={(e) => { e.preventDefault(); setRoleTouched(true); if (email && orgId && isInviteRoleValid(roleSlug)) createSingle.mutate({ email, organizationId: orgId, roleSlug: roleSlug.trim() }); }} className="space-y-4">
          <div>
            <label htmlFor="invite-wizard-email" className={FIELD_LABEL_CLASSES}>{inv.emailRequired}</label>
            <input id="invite-wizard-email" type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="usuario@empresa.com" className={inputClasses('md')} required />
          </div>
          <div>
            <label htmlFor="invite-wizard-role" className={FIELD_LABEL_CLASSES}>{inv.role} *</label>
            {invitationRoles.isError && <ErrorState size="inline" className="mb-2" onRetry={() => invitationRoles.refetch()} />}
            <select
              id="invite-wizard-role"
              aria-invalid={roleError || undefined}
              aria-describedby={roleError ? 'invite-wizard-role-error' : undefined}
              value={roleSlug}
              onChange={(e) => { setRoleSlug(e.target.value); setRoleTouched(true); }}
              className={selectClasses('md')}
            >
              <option value="">{inv.selectRole}</option>
              {invitationRoles.roles.map(r => <option key={r.slug} value={r.slug}>{r.label}</option>)}
            </select>
            {roleError && <p id="invite-wizard-role-error" role="alert" className={FIELD_ERROR_CLASSES}>{inv.roleRequired}</p>}
          </div>
          <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
            <Button variant="secondary" onClick={onClose}>{t.common.cancel}</Button>
            <Button type="submit" disabled={!email || !orgId} loading={createSingle.isPending} loadingLabel={inv.sending}>
              {inv.sendInvitation}
            </Button>
          </div>
        </form>
      )}

      {/* === BULK MODE === */}
      {mode === 'bulk' && bulkStep === 'upload' && (
        <div className="space-y-4">
          <div className="rounded-xl border-2 border-dashed border-field-border p-6 text-center md:p-8">
            <svg className="mx-auto mb-3 size-8 text-muted" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" /></svg>
            <p className="mb-3 text-body text-primary">{inv.dragCsvHere}</p>
            <label className={buttonClasses({ variant: 'secondary' })}>
              {inv.selectFile}
              <input type="file" accept=".csv,.tsv,.txt,.xlsx" onChange={handleFileUpload} className="sr-only" />
            </label>
          </div>
          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-white px-3 text-callout text-secondary">{inv.pasteDataDirectly}</span></div>
          </div>
          <label htmlFor="invite-wizard-paste" className="sr-only">{inv.pasteLabel}</label>
          <textarea
            id="invite-wizard-paste"
            rows={4}
            aria-describedby="invite-wizard-format"
            placeholder={"email,nombre,apellido,rol\njuan@empresa.com,Juan,Perez,recruiter\nmaria@empresa.com,Maria,Lopez,hr_admin"}
            className={textareaClasses('resize-none font-mono')}
            onPaste={(e) => { const text = e.clipboardData.getData('text'); if (text.includes('\n') || text.includes('\t')) { e.preventDefault(); handlePaste(text); } }}
            onChange={(e) => { if (e.target.value.includes('\n')) handlePaste(e.target.value); }}
          />
          <p id="invite-wizard-format" className="rounded-lg bg-info-bg p-3 text-callout text-info">
            <strong>{inv.expectedFormat}</strong> {inv.csvColumnsHelp}
          </p>
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
