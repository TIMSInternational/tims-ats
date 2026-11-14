'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { Button, EmptyState, ErrorState, Field, Skeleton, TextInput } from '../../../../components';

export function PlatformOwnerSection() {
  const { t } = useI18n();
  const sp = t.support;
  const [newEmail, setNewEmail] = useState('');
  // The allowlist grants cross-tenant access, so the address is typed twice before it is added
  // (platform-owner journeys-30): a typo can no longer authorize a stranger's mailbox.
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: emailsData, isLoading, isError, error, refetch } = trpc.platform.listPlatformOwnerEmails.useQuery();
  const addEmail = trpc.platform.addPlatformOwnerEmail.useMutation({
    onSuccess: () => {
      setNewEmail('');
      setConfirmEmail('');
      utils.platform.listPlatformOwnerEmails.invalidate();
      toast(sp.emailAdded, { type: 'success' });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });
  const removeEmail = trpc.platform.removePlatformOwnerEmail.useMutation({
    onSuccess: (result) => {
      setConfirmRemove(null);
      utils.platform.listPlatformOwnerEmails.invalidate();
      toast(result.ownersRevoked > 0 ? `${sp.emailRemoved}. ${sp.ownerAccessRevoked}` : sp.emailRemoved, {
        type: 'success',
      });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const emails = emailsData ?? [];
  const typed = newEmail.trim().toLowerCase();
  const confirmed = confirmEmail.trim().toLowerCase();
  const mismatch = confirmed.length > 0 && typed !== confirmed;
  const canAdd = typed.includes('@') && typed === confirmed && !addEmail.isPending;

  return (
    <section aria-labelledby="owner-emails-title" className="rounded-xl bg-white p-5 shadow-card">
      <h2 id="owner-emails-title" className="mb-4 text-heading font-semibold text-brand">
        {sp.platformOwnerEmails}
      </h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canAdd) addEmail.mutate({ email: typed });
        }}
        className="mb-5 space-y-3"
      >
        <p className="rounded-lg bg-warning-bg px-3 py-2 text-callout text-warning">{sp.addOwnerWarning}</p>
        <Field label={sp.ownerEmailLabel} id="owner-email">
          <TextInput
            type="email"
            maxLength={255}
            autoComplete="off"
            placeholder={sp.ownerEmailPlaceholder}
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
        </Field>
        <Field
          label={sp.confirmEmailLabel}
          id="owner-email-confirm"
          error={mismatch ? sp.confirmEmailMismatch : undefined}
        >
          {(control) => (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <TextInput
                {...control}
                type="email"
                maxLength={255}
                autoComplete="off"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                onPaste={(e) => e.preventDefault()}
                className="min-w-0 flex-1"
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={!canAdd}
                loading={addEmail.isPending}
                className="shrink-0"
              >
                {sp.addEmail}
              </Button>
            </div>
          )}
        </Field>
      </form>

      <h3 className="mb-2 text-subheading font-semibold text-primary">{sp.currentWhitelist}</h3>
      {isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState size="compact" onRetry={() => refetch()} error={error} message={sp.ownerEmailsLoadError} />
      ) : emails.length === 0 ? (
        <EmptyState size="compact" title={sp.noEmails} description={sp.noEmailsDesc} />
      ) : (
        <ul className="max-h-[280px] space-y-2 overflow-y-auto">
          {emails.map((item) => {
            const email = typeof item === 'string' ? item : item.email;
            const isConfirming = confirmRemove === email;
            return (
              <li
                key={email}
                className={`flex items-center gap-3 rounded-lg border p-2.5 ${isConfirming ? 'border-danger/40 bg-danger-bg' : 'border-border'}`}
              >
                <div
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-tint text-caption font-semibold text-brand"
                >
                  {email.charAt(0).toUpperCase()}
                </div>
                <span className="min-w-0 flex-1 truncate text-body font-medium text-primary">{email}</span>
                {isConfirming && (
                  <Button size="sm" variant="tertiary" onClick={() => setConfirmRemove(null)}>
                    {t.common.cancel}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={isConfirming ? 'destructive' : 'destructive-secondary'}
                  onClick={() => (isConfirming ? removeEmail.mutate({ email }) : setConfirmRemove(email))}
                  disabled={removeEmail.isPending && !isConfirming}
                  loading={removeEmail.isPending && isConfirming}
                  aria-label={isConfirming ? `${sp.confirm}: ${email}` : `${sp.remove}: ${email}`}
                >
                  {isConfirming ? sp.confirm : sp.remove}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 rounded-lg bg-info-bg p-3 text-callout text-info">{sp.whitelistInfo}</p>
    </section>
  );
}
