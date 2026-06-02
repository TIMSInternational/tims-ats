'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import type { OrganizationListItem } from '../../../../lib/trpc-types';

interface OrgActionsDropdownProps {
  org: OrganizationListItem;
  onEdit: (org: OrganizationListItem) => void;
}

export function OrgActionsDropdown({ org, onEdit }: OrgActionsDropdownProps) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const utils = trpc.useUtils();
  const suspendOrg = trpc.platform.suspendOrganization.useMutation({
    onSuccess: () => {
      utils.platform.listOrganizations.invalidate();
      utils.platform.getOrganizationKpis.invalidate();
      toast(org.isActive ? 'Organizacion suspendida' : 'Organizacion activada', { type: 'success' });
    },
    onError: (err) => {
      toast(err.message || 'Error al cambiar estado', { type: 'error' });
    },
  });

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleSuspendToggle = () => {
    setOpen(false);
    setShowConfirm(true);
  };

  const confirmSuspendToggle = () => {
    setShowConfirm(false);
    suspendOrg.mutate({ id: org.id, suspend: org.isActive });
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="w-7 h-7 rounded-md hover:bg-[#F6F6F6] flex items-center justify-center transition"
        aria-label={t.common.actions}
      >
        <svg className="w-4 h-4 text-[#8B8B8B]" fill="currentColor" viewBox="0 0 20 20">
          <circle cx="10" cy="4" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="10" cy="16" r="1.5" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-50 w-48 bg-white rounded-xl shadow-lg border border-[#EDEDED] py-1 animate-in fade-in"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => { router.push(`/platform/organizations/${org.id}`); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-[#333] hover:bg-[#FAFAFA] transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
            {t.organizations.viewDetails}
          </button>
          <button
            onClick={() => { onEdit(org); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-[#333] hover:bg-[#FAFAFA] transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
            {t.organizations.edit}
          </button>
          <button
            onClick={() => { router.push(`/platform/invoices?org=${org.id}`); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-[#333] hover:bg-[#FAFAFA] transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /><path d="M16 13H8m8 4H8m2-8H8" /></svg>
            {t.organizations.viewInvoices}
          </button>
          <button
            onClick={() => { router.push(`/platform/organizations/${org.id}?tab=users`); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-[#333] hover:bg-[#FAFAFA] transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87m-4-12a4 4 0 010 7.75" /></svg>
            {t.organizations.viewUsers}
          </button>
          <button
            onClick={() => { router.push(`/platform/organizations/${org.id}?tab=features`); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-sm text-[#333] hover:bg-[#FAFAFA] transition flex items-center gap-2"
          >
            <svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
            {t.organizations.features}
          </button>

          <div className="border-t border-[#EDEDED] my-1" />

          <button
            onClick={handleSuspendToggle}
            disabled={suspendOrg.isPending}
            className={`w-full text-left px-3 py-2 text-sm font-medium hover:bg-[#FAFAFA] transition flex items-center gap-2 ${
              org.isActive ? 'text-[#DD0C15]' : 'text-green-600'
            } disabled:opacity-50`}
          >
            {org.isActive ? (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
                {t.organizations.suspend}
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                {t.organizations.activate}
              </>
            )}
          </button>
        </div>
      )}
      {showConfirm && (
        <Modal
          title={`${org.isActive ? t.organizations.suspend : t.organizations.activate} ${org.name}?`}
          onClose={() => setShowConfirm(false)}
          maxWidth="max-w-sm"
        >
          <p className="text-sm text-[#585858] mb-4">
            {org.isActive ? t.organizations.confirmBulkSuspend : t.organizations.confirmBulkActivate}
          </p>
          <div className="flex gap-3">
            <button onClick={() => setShowConfirm(false)} className="flex-1 h-9 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition">{t.common.cancel}</button>
            <button
              onClick={confirmSuspendToggle}
              className={`flex-1 h-9 rounded-lg text-sm text-white font-medium transition ${org.isActive ? 'bg-[#DD0C15] hover:bg-[#c40b13]' : 'bg-green-500 hover:bg-green-600'}`}
            >
              {org.isActive ? t.organizations.suspend : t.organizations.activate}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
