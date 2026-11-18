'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { formatMessage, useI18n } from '../../../../lib/i18n';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  Field,
  FIELD_LABEL_CLASSES,
  Select,
  TextArea,
  TextInput,
} from '../../../../components';
import { EmailActionForm } from './email-action-form';

type NotifType = 'info' | 'warning' | 'critical' | 'success';

export function QuickActions() {
  const { t } = useI18n();
  const sp = t.support;
  const [notifOrgId, setNotifOrgId] = useState('');
  const [notifTitle, setNotifTitle] = useState('');
  const [notifMessage, setNotifMessage] = useState('');
  const [notifType, setNotifType] = useState<NotifType>('info');
  const [confirmNotif, setConfirmNotif] = useState(false);

  const {
    data: orgs,
    isError: orgsError,
    error: orgsLoadError,
    refetch: refetchOrgs,
  } = trpc.platform.listOrganizationsMinimal.useQuery();

  const resetMutation = trpc.platform.resetUserPassword.useMutation({
    onSuccess: (data) => {
      toast(formatMessage(sp.resetSent, { email: data.email }), { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const logoutMutation = trpc.platform.forceLogoutUser.useMutation({
    onSuccess: (data) => {
      toast(`${sp.forceLogoutDone}: ${data.email}`, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const notifMutation = trpc.platform.sendBulkNotification.useMutation({
    onSuccess: (data) => {
      toast(formatMessage(sp.notifSent, { count: data.sent }), { type: 'success' });
      setConfirmNotif(false);
      setNotifTitle('');
      setNotifMessage('');
      setNotifOrgId('');
      setNotifType('info');
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  // "Todas las organizaciones" is the default recipient, so every send is confirmed with its audience (D-14).
  const notifOrgName = orgs?.find((o) => o.id === notifOrgId)?.name;
  const notifAudience =
    notifOrgId && notifOrgName ? sp.notifConfirmOrg.replace('{org}', notifOrgName) : sp.notifConfirmAll;

  return (
    <section aria-labelledby="quick-actions-title" className="rounded-xl bg-white p-5 shadow-card">
      <h2 id="quick-actions-title" className="mb-4 text-heading font-semibold text-brand">
        {sp.quickActions}
      </h2>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <EmailActionForm
          label={sp.resetPassword}
          help={sp.resetDesc}
          placeholder={sp.resetPlaceholder}
          submitLabel={sp.sendReset}
          isPending={resetMutation.isPending}
          onSubmit={(email, done) => resetMutation.mutate({ email }, { onSuccess: done })}
        />
        <EmailActionForm
          label={sp.forceLogout}
          help={sp.forceLogoutDesc}
          placeholder={sp.forceLogoutPlaceholder}
          submitLabel={sp.forceLogoutBtn}
          destructive
          isPending={logoutMutation.isPending}
          onSubmit={(email, done) => logoutMutation.mutate({ email }, { onSuccess: done })}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (notifTitle.trim() && notifMessage.trim()) setConfirmNotif(true);
          }}
          className="space-y-3 rounded-lg border border-border p-4 md:col-span-2"
        >
          <h3 className="text-subheading font-semibold text-primary">{sp.sendNotification}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {orgsError ? (
              <div>
                <p className={FIELD_LABEL_CLASSES}>{sp.notifRecipients}</p>
                <ErrorState
                  size="inline"
                  onRetry={() => refetchOrgs()}
                  error={orgsLoadError}
                  message={sp.orgsLoadError}
                />
              </div>
            ) : (
              <Field label={sp.notifRecipients}>
                <Select value={notifOrgId} onChange={(e) => setNotifOrgId(e.target.value)}>
                  <option value="">{sp.allOrgs}</option>
                  {orgs?.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label={sp.notifTypeLabel}>
              <Select value={notifType} onChange={(e) => setNotifType(e.target.value as NotifType)}>
                <option value="info">{sp.typeInfo}</option>
                <option value="warning">{sp.typeWarning}</option>
                <option value="critical">{sp.typeCritical}</option>
                <option value="success">{sp.typeSuccess}</option>
              </Select>
            </Field>
          </div>
          <Field label={sp.notifTitle}>
            <TextInput value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} maxLength={200} />
          </Field>
          <Field label={sp.notifMessageLabel}>
            <TextArea
              placeholder={sp.notifMessage}
              rows={3}
              value={notifMessage}
              onChange={(e) => setNotifMessage(e.target.value)}
              maxLength={1000}
              className="resize-none"
            />
          </Field>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!notifTitle.trim() || !notifMessage.trim()}
              loading={notifMutation.isPending}
              loadingLabel={sp.sending}
              className="w-full sm:w-auto"
            >
              {sp.sendNotification}
            </Button>
          </div>
        </form>
      </div>
      {confirmNotif && (
        <ConfirmDialog
          title={sp.notifConfirmTitle}
          description={notifAudience}
          confirmLabel={sp.notifConfirmSend}
          confirmingLabel={sp.sending}
          loading={notifMutation.isPending}
          onConfirm={() =>
            notifMutation.mutate({
              organizationId: notifOrgId || undefined,
              title: notifTitle.trim(),
              message: notifMessage.trim(),
              type: notifType,
            })
          }
          onCancel={() => setConfirmNotif(false)}
        >
          <p className="text-body font-medium text-primary">{notifTitle.trim()}</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
