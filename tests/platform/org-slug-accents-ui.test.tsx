import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    platform: {
      createOrganization: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      createOrgInvitation: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock('../../apps/web/lib/platform-api/client', () => ({ platformPost: vi.fn(), isPlatformApiEnabled: () => true }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));

import { CreateOrgModal } from '../../apps/web/app/(admin)/platform/organizations/create-org-modal';
import { InviteOrgModal } from '../../apps/web/app/(admin)/platform/invitations/invite-org-modal';

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
}

function slugValue(container: HTMLElement): string {
  const slugInput = [...container.querySelectorAll('input')].find((input) => input.className.includes('font-mono'));
  if (!slugInput) throw new Error('slug input not found');
  return slugInput.value;
}

describe('organization slug fields', () => {
  it('"Nueva Organización" derives logistica from Logística', () => {
    const view = render(<CreateOrgModal onClose={vi.fn()} onSuccess={vi.fn()} />, { wrapper });
    const [nameInput] = view.getAllByRole('textbox');
    fireEvent.change(nameInput, { target: { value: 'Logística Andina' } });
    expect(slugValue(view.container)).toBe('logistica-andina');
  });

  it('"Invitar Organización" derives logistica from Logística and folds hand-typed accents', () => {
    const view = render(<InviteOrgModal onClose={vi.fn()} onSuccess={vi.fn()} />, { wrapper });
    const nameInput = view.getAllByRole('textbox')[1];
    fireEvent.change(nameInput, { target: { value: 'Logística Andina' } });
    expect(slugValue(view.container)).toBe('logistica-andina');
    const slugInput = [...view.container.querySelectorAll('input')].find((input) =>
      input.className.includes('font-mono'),
    )!;
    fireEvent.change(slugInput, { target: { value: 'compañía' } });
    expect(slugValue(view.container)).toBe('compania');
  });
});
