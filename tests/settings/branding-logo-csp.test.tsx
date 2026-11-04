import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

// D-05: a logo the CSP img-src would block is never shown to candidates, so the branding page
// refuses to save it and says why (instead of saving a logo that silently never appears).

const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: es, locale: 'ES' }) }));
vi.mock('../../apps/web/lib/toast', () => ({ toast: vi.fn() }));
vi.mock('../../apps/web/components', () => ({ Skeleton: () => null, ErrorState: () => null }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      organization: { getCurrent: { invalidate: vi.fn() }, getSetupStatus: { invalidate: vi.fn() } },
    }),
    organization: {
      getCurrent: { useQuery: () => ({ data: { logo: null }, isLoading: false, isError: false, refetch: vi.fn() }) },
      update: { useMutation: () => ({ mutate: mocks.mutate, isPending: false }) },
    },
  },
}));

import BrandingPage from '../../apps/web/app/(admin)/settings/branding/page';

const saveButton = () => screen.getByRole('button', { name: es.common.save });

beforeEach(() => {
  mocks.mutate.mockReset();
});

describe('branding logo URL', () => {
  it('refuses a logo hosted where the CSP would block it, and explains why', () => {
    render(<BrandingPage />);
    fireEvent.change(screen.getByPlaceholderText(es.branding.logoPlaceholder), {
      target: { value: 'https://www.example.go.cr/logo.png' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent(es.branding.logoHostBlocked);
    expect(saveButton()).toBeDisabled();
    expect(document.querySelector('img')).toBeNull();
  });

  it('saves a logo on an allowed host', () => {
    render(<BrandingPage />);
    fireEvent.change(screen.getByPlaceholderText(es.branding.logoPlaceholder), {
      target: { value: 'https://abc.supabase.co/storage/v1/object/public/logos/a.png' },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(saveButton());
    expect(mocks.mutate).toHaveBeenCalledWith({ logo: 'https://abc.supabase.co/storage/v1/object/public/logos/a.png' });
  });

  it('refuses a logo whose preview failed to load', () => {
    render(<BrandingPage />);
    fireEvent.change(screen.getByPlaceholderText(es.branding.logoPlaceholder), {
      target: { value: 'https://abc.supabase.co/missing.png' },
    });
    fireEvent.error(document.querySelector('img')!);
    expect(screen.getByText(es.branding.previewError)).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();
  });
});
