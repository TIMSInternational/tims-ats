'use client';

import { createContext, useContext, type ReactNode } from 'react';

// The organization's name and logo for client pages under /careers/[orgSlug] that cannot load the org row
// themselves (the passwordless login page is a client page). Provided once by the careers layout, which
// already reads the organization by slug. Pilot UX re-audit C-25: the login tile showed a hard-coded "T".

export interface PortalOrgBrand {
  name: string;
  logo: string | null;
}

const PortalOrgBrandContext = createContext<PortalOrgBrand | null>(null);

export function PortalOrgBrandProvider({ brand, children }: { brand: PortalOrgBrand; children: ReactNode }) {
  return <PortalOrgBrandContext.Provider value={brand}>{children}</PortalOrgBrandContext.Provider>;
}

/** The organization's brand, or null outside the careers layout. */
export function usePortalOrgBrand(): PortalOrgBrand | null {
  return useContext(PortalOrgBrandContext);
}
