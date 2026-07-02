'use client';

import { useSearchParams } from 'next/navigation';
import { useState, Suspense } from 'react';
import { trpc } from '../../lib/trpc';
import { useI18n } from '../../lib/i18n';

function AcceptInvitationContent() {
  const { t } = useI18n();
  const ti = t.invitations;
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const [accepted, setAccepted] = useState(false);

  const invitation = trpc.platform.getInvitationByToken.useQuery(
    { token },
    { enabled: !!token, retry: false }
  );

  const accept = trpc.platform.acceptInvitation.useMutation({
    onSuccess: () => setAccepted(true),
  });

  if (!token) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.invalidLink}</h1>
          <p className="text-sm text-[#8B8B8B]">{ti.invalidLinkDesc}</p>
        </div>
      </div>
    );
  }

  if (invitation.isLoading) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-[#1F114C]/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-7 h-7 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.verifying}</h1>
          <p className="text-sm text-[#8B8B8B]">{ti.oneMoment}</p>
        </div>
      </div>
    );
  }

  if (invitation.error || !invitation.data) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.notFound}</h1>
          <p className="text-sm text-[#8B8B8B]">{invitation.error?.message || 'El enlace puede haber expirado o ser invalido.'}</p>
        </div>
      </div>
    );
  }

  const inv = invitation.data;

  if (inv.status === 'expired') {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.expired}</h1>
          <p className="text-sm text-[#8B8B8B] mb-4">{ti.expiredDesc}</p>
          <p className="text-xs text-[#8B8B8B]">Organizacion: <strong>{inv.organizationName}</strong></p>
        </div>
      </div>
    );
  }

  if (inv.status === 'revoked') {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.revoked}</h1>
          <p className="text-sm text-[#8B8B8B]">{ti.revokedDesc}</p>
        </div>
      </div>
    );
  }

  if (inv.status === 'accepted' || accepted) {
    return (
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">{ti.accepted}</h1>
          <p className="text-sm text-[#8B8B8B] mb-6">
            {inv.type === 'org_admin' ? (
              <>{ti.orgReadyAdminPrefix} {inv.organizationName} {ti.orgReadyAdminSuffix}</>
            ) : (
              <>{ti.memberAddedPrefix} {inv.organizationName}. {ti.memberAddedSuffix}</>
            )}
          </p>
          <a href="/login" className="inline-flex items-center gap-2 h-10 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition">
            {inv.type === 'org_admin' ? t.auth.createAccount : t.auth.login}
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg>
          </a>
        </div>
      </div>
    );
  }

  // Pending / sent — show accept form
  return (
    <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        {/* Logo */}
        <div className="flex justify-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-[#DD0C15] flex items-center justify-center">
            <span className="text-white text-2xl font-bold">T</span>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-[#333] mb-2">
          {inv.type === 'org_admin' ? ti.manageOrgHeading : ti.joinTeamHeading}
        </h1>
        <p className="text-sm text-[#8B8B8B] mb-8">
          {inv.type === 'org_admin' ? (
            <>{ti.invitedAdminPrefix} {inv.organizationName} {ti.invitedAdminSuffix}</>
          ) : (
            <>
              {ti.invitedMemberPrefix} {inv.organizationName} {ti.invitedMemberMiddle}
              {inv.roleSlug ? <> {ti.asRole} {inv.roleSlug.replace(/_/g, ' ')}</> : null}.
            </>
          )}
        </p>

        {/* Invitation details */}
        <div className="bg-[#F6F6F6] rounded-xl p-5 mb-6 text-left">
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-[#8B8B8B]">Email</span>
              <span className="font-medium text-[#333]">{inv.email}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#8B8B8B]">Organizacion</span>
              <span className="font-medium text-[#333]">{inv.organizationName}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[#8B8B8B]">Tipo</span>
              <span className="font-medium text-[#333]">{inv.type === 'org_admin' ? 'Administrador' : 'Usuario'}</span>
            </div>
            {inv.roleSlug && (
              <div className="flex justify-between text-sm">
                <span className="text-[#8B8B8B]">Rol</span>
                <span className="font-medium text-[#333]">{inv.roleSlug.replace(/_/g, ' ')}</span>
              </div>
            )}
          </div>
        </div>

        {accept.error && (
          <div className="text-xs text-[#DD0C15] bg-red-50 px-3 py-2 rounded-lg mb-4">
            {accept.error.message}
          </div>
        )}

        <button
          onClick={() => accept.mutate({ token })}
          disabled={accept.isPending}
          className="w-full h-11 rounded-xl bg-[#1F114C] text-white text-sm font-semibold hover:bg-[#2a1866] transition disabled:opacity-50"
        >
          {accept.isPending ? ti.accepting : ti.acceptButton}
        </button>

        <p className="text-[10px] text-[#8B8B8B] mt-6">
          {ti.confirmJoin}
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#FAFAFA] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
          <div className="w-14 h-14 rounded-full bg-[#1F114C]/10 flex items-center justify-center mx-auto mb-4 animate-pulse">
            <svg className="w-7 h-7 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
          </div>
          <h1 className="text-xl font-semibold text-[#333] mb-2">Cargando...</h1>
        </div>
      </div>
    }>
      <AcceptInvitationContent />
    </Suspense>
  );
}
