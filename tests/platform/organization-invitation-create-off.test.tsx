import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_ORG_INVITATION_CREATE_VIA_CSHARP = 'false';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), enabled: true }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPost: mocks.post, isPlatformApiEnabled: () => mocks.enabled }));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { platform: { createOrgInvitation: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } } }));
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: { invitations: { creationUnavailable: 'unavailable' } } }) }));
const input = { email: 'admin@example.test', organizationName: 'Example', organizationSlug: 'example', organizationPlan: 'trial' as const };
const response = { id: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222', delivery: 'accepted' };
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>; }
beforeEach(() => { mocks.enabled = true; mocks.post.mockReset(); mocks.legacy.mockReset(); });

it('uses only the legacy writer when the flag is false', async () => {
  mocks.legacy.mockResolvedValue({});
  const { useOrganizationInvitationCreate } = await import('../../apps/web/lib/platform-api/organization-invitation-create');
  const { result } = renderHook(() => useOrganizationInvitationCreate(), { wrapper });
  await act(() => result.current.mutateAsync(input));
  expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith(input);
  expect(mocks.post).not.toHaveBeenCalled();
});
