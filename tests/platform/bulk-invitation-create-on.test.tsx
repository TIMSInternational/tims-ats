import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, render, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

process.env.NEXT_PUBLIC_BULK_INVITATION_VIA_CSHARP = 'true';
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
it('returns correlated per-row outcomes using only C#',async()=>{
  mocks.post.mockResolvedValue(response); const {result}=await hook();
  await act(async()=>{expect(await result.current.mutateAsync(input)).toEqual(response);});
  expect(mocks.post).toHaveBeenCalledExactlyOnceWith('/platform/invitations/bulk',input);
  expect(mocks.legacy).not.toHaveBeenCalled();
});
it.each([
  {...response,results:[]},
  {...response,summary:{...response.summary,sent:0}},
  {...response,results:[{...response.results[0],email:'different@example.test'}]},
  {...response,results:[{...response.results[0],index:1}]},
  {...response,results:[{...response.results[0],reason:'already_invited'}]},
  {...response,token:'secret'},
])('rejects malformed or uncorrelated response without fallback',async body=>{
  mocks.post.mockResolvedValue(body);const {result}=await hook();
  await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toThrow();});
  expect(mocks.post).toHaveBeenCalledOnce();expect(mocks.legacy).not.toHaveBeenCalled();
});
it('never retries uncertain transport',async()=>{
  mocks.post.mockRejectedValue(new Error('uncertain'));const {result}=await hook();
  await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toThrow();});
  expect(mocks.post).toHaveBeenCalledOnce();expect(mocks.legacy).not.toHaveBeenCalled();
});
it('fails closed without API configuration',async()=>{
  mocks.enabled=false; const {result}=await hook();
  await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toThrow();});
  expect(mocks.post).not.toHaveBeenCalled();expect(mocks.legacy).not.toHaveBeenCalled();
});
it.each([0,201])('rejects %i rows before writing',async count=>{
  const {result}=await hook();
  await act(async()=>{await expect(result.current.mutateAsync({...input,users:Array.from({length:count},()=>input.users[0])})).rejects.toThrow();});
  expect(mocks.post).not.toHaveBeenCalled();expect(mocks.legacy).not.toHaveBeenCalled();
});
