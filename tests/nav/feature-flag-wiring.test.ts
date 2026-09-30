import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The flag gate for the Equipo nav item and the setup-checklist link is behaviourally pinned in
// tests/nav/manifest.test.ts and tests/dashboard/setup-checklist.test.ts, but only if the call sites pass the
// real flag through. These source pins catch a call site that drops it (the checklist would link to a dead end;
// the sidebars would silently hide Equipo even with the flag on), following tests/access/role-aware-ui.test.ts.
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');

describe('feature-flag wiring at the call sites', () => {
  it.each(['apps/web/app/(admin)/sidebar.tsx', 'apps/web/app/(admin)/participant-sidebar.tsx'])(
    '%s passes isNavFeatureOn to computeVisibleSections',
    (file) => {
      expect(read(file)).toMatch(/computeVisibleSections\(manifestFor\(roles\)\.sections, can, isLoading, isNavFeatureOn\)/);
    },
  );

  it('setup-checklist passes isTenantInvitationsEnabled() as the invitationsEnabled argument', () => {
    const src = read('apps/web/app/(admin)/dashboard/setup-checklist.tsx');
    expect(src).toMatch(/const invitationsEnabled = isTenantInvitationsEnabled\(\);/);
    expect(src).toMatch(/canInviteTeam,\s*invitationsEnabled,\s*\)/);
  });
});

describe('isNavFeatureOn resolves tenantInvitations from the deploy-time env', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is off unless NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP=true AND the platform URL is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP', 'false');
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://platform.example.test');
    vi.resetModules();
    expect((await import('../../apps/web/lib/nav/feature-flags')).isNavFeatureOn('tenantInvitations')).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP', 'true');
    vi.resetModules();
    expect((await import('../../apps/web/lib/nav/feature-flags')).isNavFeatureOn('tenantInvitations')).toBe(true);
  });
});
