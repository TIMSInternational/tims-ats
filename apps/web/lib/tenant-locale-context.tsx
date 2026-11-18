'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { trpc } from './trpc';
import { DEFAULT_TENANT_LOCALE, resolveTenantLocale, type TenantLocale } from './tenant-locale';

// The signed-in organization's default currency and number locale (lib/tenant-locale.ts). ONE query per
// session, in the admin shell: organization.getCurrent, the explicit, non-sensitive profile projection any
// staff session may read. Outside the provider, before it loads, or when the organization has none
// configured, the pilot defaults (CRC, es-CR) apply — so INVU renders exactly as before.

const TenantLocaleContext = createContext<TenantLocale>(DEFAULT_TENANT_LOCALE);

function TenantLocaleQuery({ children }: { children: ReactNode }) {
  const profile = trpc.organization.getCurrent.useQuery(undefined, {
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return <TenantLocaleContext.Provider value={resolveTenantLocale(profile.data)}>{children}</TenantLocaleContext.Provider>;
}

/**
 * `enabled` is false for a platform-owner session outside impersonation: the platform console has no
 * tenant of its own, so it keeps the defaults and sends no query.
 */
export function TenantLocaleProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? <TenantLocaleQuery>{children}</TenantLocaleQuery> : <>{children}</>;
}

/** The tenant's default currency and Intl locale (pilot defaults outside a provider). */
export function useTenantLocale(): TenantLocale {
  return useContext(TenantLocaleContext);
}
