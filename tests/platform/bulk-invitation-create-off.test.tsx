import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_BULK_INVITATION_VIA_CSHARP = 'false';
const mocks = vi.hoisted(() => ({ post: vi.fn(), legacy: vi.fn(), enabled: true, toast: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPost: mocks.post, isPlatformApiEnabled: () => mocks.enabled }));
vi.mock('../../apps/web/lib/trpc', () => ({ trpc: { platform: { bulkInviteUsers: { useMutation: () => ({ mutateAsync: mocks.legacy }) } } } }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/en.json');
  return { useI18n: () => ({ t }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
const input = { organizationId: '22222222-2222-4222-8222-222222222222', users: [{email:'admin@example.test'}] };
const response = {results:[{index:0,email:'admin@example.test',status:'sent',reason:null}],summary:{total:1,sent:1,duplicates:0,errors:0}};
function wrapper({ children }: { children: React.ReactNode }) { return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>; }
beforeEach(() => { mocks.enabled = true; mocks.post.mockReset(); mocks.legacy.mockReset(); });
async function hook() {
  const {useBulkInvitationCreate}=await import('../../apps/web/lib/platform-api/bulk-invitation-create');
  return renderHook(()=>useBulkInvitationCreate(),{wrapper});
}
it('normalizes legacy outcomes without calling C#',async()=>{
  mocks.legacy.mockResolvedValue({results:[{email:input.users[0].email,status:'duplicate',message:'Already invited'}],summary:{total:1,sent:0,duplicates:1,errors:0}});
  const {result}=await hook();
  await act(async()=>{expect((await result.current.mutateAsync(input)).results[0]).toEqual({index:0,email:input.users[0].email,status:'duplicate',reason:'already_invited'});});
  expect(mocks.legacy).toHaveBeenCalledExactlyOnceWith(input);expect(mocks.post).not.toHaveBeenCalled();
});
it('never falls back or retries a failed legacy write',async()=>{
  mocks.legacy.mockRejectedValue(new Error('uncertain'));const {result}=await hook();
  await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toThrow();});
  expect(mocks.legacy).toHaveBeenCalledOnce();expect(mocks.post).not.toHaveBeenCalled();
});
