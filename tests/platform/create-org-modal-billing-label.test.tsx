import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    platform: { createOrganization: { useMutation: () => ({ mutate: mocks.mutate, isPending: false, error: null }) } },
  },
}));

import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import { CreateOrgModal } from '../../apps/web/app/(admin)/platform/organizations/create-org-modal';

describe('Nueva Organización modal — the email field is a billing email, not an admin invite', () => {
  it('labels the field as billing email and points to "Invitar Organización"', () => {
    render(<CreateOrgModal onClose={() => {}} onSuccess={() => {}} />);
    expect(screen.getByLabelText(es.organizations.billingEmailLabel)).toBeTruthy();
    expect(screen.getByText(es.organizations.billingEmailHint)).toBeTruthy();
    expect(screen.queryByText('Email del Administrador')).toBeNull();
    expect(es.organizations.billingEmailLabel.toLowerCase()).toBe('email de facturación');
    expect(en.organizations.billingEmailLabel.toLowerCase()).toBe('billing email');
    expect(es.organizations.billingEmailHint).toContain('Invitar Organización');
    expect('adminEmailLabel' in es.organizations).toBe(false);
    expect('adminEmailLabel' in en.organizations).toBe(false);
  });

  it('still submits the unchanged payload (adminEmail key → billing_email server-side)', () => {
    const { container } = render(<CreateOrgModal onClose={() => {}} onSuccess={() => {}} />);
    const inputs = container.querySelectorAll('input');
    fireEvent.change(inputs[0], { target: { value: 'Acme' } });
    fireEvent.change(inputs[1], { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText(es.organizations.billingEmailLabel), { target: { value: 'pay@acme.test' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({
      name: 'Acme',
      slug: 'acme',
      plan: 'trial',
      adminEmail: 'pay@acme.test',
    });
  });
});
