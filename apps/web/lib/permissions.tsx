'use client';

import { createContext, useContext, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { trpc } from './trpc';
import { useI18n } from './i18n';
import { moduleForPath } from './nav/routes';

// PATH_MODULE (route → module map) and moduleForPath (longest-prefix matcher)
// now live in the pure, React-free `./nav/routes` module so node tests and the
// sidebar manifest can import them without dragging React/tRPC in. Re-exported
// here so existing importers of `lib/permissions` keep working unchanged.
// (moduleForPath is also imported above for RouteAccessGuard's local use.)
export { PATH_MODULE, moduleForPath } from './nav/routes';

// Role-label precedence: widest first. roleLabel = the top-ranked role the user
// holds, resolved through i18n roles.*.
const ROLE_PRECEDENCE = [
  'platform_owner',
  'super_admin',
  'hr_admin',
  'hrbp',
  'recruiter',
  'leader',
  'committee',
  'employee',
] as const;

type RoleSlug = (typeof ROLE_PRECEDENCE)[number];

interface PermissionsContextValue {
  /** True if the user may read/act on `module`. UX gate only. */
  can: (module: string, action?: string) => boolean;
  roles: string[];
  /** i18n-resolved label for the top-precedence role, or '' while unresolved. */
  roleLabel: string;
  isLoading: boolean;
  /** True for platform owner / super_admin — bypasses all module gates. */
  isPrivileged: boolean;
  /** The signed-in user's id, or null while session info is still loading. */
  userId: string | null;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  can: () => true,
  roles: [],
  roleLabel: '',
  isLoading: false,
  isPrivileged: false,
  userId: null,
});

export function PermissionsProvider({
  children,
  isPlatformOwner,
}: {
  children: React.ReactNode;
  isPlatformOwner: boolean;
}) {
  const { t } = useI18n();
  const { data, isLoading, isError } = trpc.auth.getSessionInfo.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // UI gating is UX only — the tRPC API stays the enforcement boundary. A
  // network blip fetching sessionInfo must never blank the app, so on error we
  // fail OPEN for rendering and let the API reject anything the user truly
  // can't do.
  if (isError) {
    console.warn(
      '[permissions] getSessionInfo failed — failing OPEN for UI rendering; the API remains the enforcement boundary',
    );
  }

  const value = useMemo<PermissionsContextValue>(() => {
    const roles = data?.roles ?? [];
    const isPrivileged =
      isPlatformOwner ||
      roles.includes('super_admin') ||
      roles.includes('platform_owner');

    // Grants keyed by module:action — can() is ACTION-AWARE (codex: collapsing
    // every action to read let can('x','create') pass with read-only access).
    const grants = new Set<string>();
    for (const p of data?.permissions ?? []) {
      grants.add(`${p.module}:${p.action}`);
    }

    const can = (module: string, action: string = 'read'): boolean => {
      // Privileged bypass mirrors build.ts: platform owner / super_admin always
      // pass, otherwise they'd see an empty app (no rolePermission rows).
      if (isPrivileged) return true;
      // During load (or on a failed/empty fetch) fail OPEN — the guard handles
      // the loading skeleton; the API is the real gate.
      if (isLoading || isError || !data) return true;
      return grants.has(`${module}:${action}`);
    };

    // roleLabel = top-precedence role resolved via i18n roles.*.
    const top = isPlatformOwner
      ? ('platform_owner' as RoleSlug)
      : ROLE_PRECEDENCE.find((r) => roles.includes(r));
    const roleLabel = top ? t.roles[top] : '';

    const userId = data?.user?.id ?? null;

    return { can, roles, roleLabel, isLoading, isPrivileged, userId };
  }, [data, isLoading, isError, isPlatformOwner, t]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextValue {
  return useContext(PermissionsContext);
}

export function useCan(): (module: string, action?: string) => boolean {
  return usePermissions().can;
}

// Neutral loading skeleton — shown while sessionInfo resolves. NEVER show
// AccessDenied during load.
function GuardSkeleton() {
  return (
    <div className="p-6">
      <div className="h-8 w-48 rounded bg-[#ECECEC] animate-pulse" />
      <div className="mt-4 h-32 rounded-lg bg-[#ECECEC] animate-pulse" />
    </div>
  );
}

export function AccessDenied() {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-[#ECECEC] bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#F6F6F6]">
          <svg
            className="h-6 w-6 text-[#1F114C]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-[#1F114C]">
          {t.accessDenied.title}
        </h1>
        <p className="mt-2 text-sm text-[#8B8B8B]">{t.accessDenied.message}</p>
        <button
          onClick={() => router.push('/dashboard')}
          className="mt-6 h-9 rounded-lg bg-[#1F114C] px-4 text-sm font-medium text-white transition hover:bg-[#2a1866]"
        >
          {t.accessDenied.back}
        </button>
      </div>
    </div>
  );
}

export function RouteAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, isLoading, isPrivileged } = usePermissions();

  // Resolve the path FIRST (codex: ungated routes — /dashboard, /settings,
  // /mfa… — must render immediately, never wait on a slow/hung sessionInfo).
  const module = moduleForPath(pathname);
  // undefined (unmapped) or null → always allowed; the API stays the boundary.
  if (module === undefined || module === null) return <>{children}</>;

  // Gated route: loading → neutral skeleton, never AccessDenied. Privileged →
  // straight in.
  if (isLoading && !isPrivileged) return <GuardSkeleton />;

  return can(module, 'read') ? <>{children}</> : <AccessDenied />;
}
