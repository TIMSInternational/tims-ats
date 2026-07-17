'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { httpBatchLink } from '@trpc/client';
import { trpc } from './trpc';
import { MFA_REQUIRED } from '@tims/shared';
import superjson from 'superjson';

// CB-2a: when the API-layer MFA gate blocks a privileged aal1 session it throws a
// FORBIDDEN carrying the MFA_REQUIRED marker as its message. Redirect such a session to
// /mfa to step up (the same destination as the (admin) page gate). Guarded so the
// redirect fires at most once per navigation. A tRPCClientError surfaces the server
// message verbatim.
function redirectToMfaIfRequired(err: unknown): void {
  if (typeof window === 'undefined') return;
  const message = (err as { message?: unknown } | null)?.message;
  if (message === MFA_REQUIRED && window.location.pathname !== '/mfa') {
    window.location.assign('/mfa');
  }
}

export function TRPCProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: redirectToMfaIfRequired }),
        mutationCache: new MutationCache({ onError: redirectToMfaIfRequired }),
        defaultOptions: {
          queries: {
            staleTime: 300_000, // 5 minutes
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: '/api/trpc',
          transformer: superjson,
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
