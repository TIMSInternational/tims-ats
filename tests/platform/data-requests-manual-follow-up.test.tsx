import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import es from '../../apps/web/lib/i18n/es.json';

const { fetchExport, toastMock } = vi.hoisted(() => ({ fetchExport: vi.fn(), toastMock: vi.fn() }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: { useUtils: () => ({ platform: { exportSubjectData: { fetch: fetchExport } } }) },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: toastMock }));

import { DataRequests } from '../../apps/web/app/(admin)/platform/support/data-requests';

const createObjectUrl = vi.fn(() => 'blob:dsar-test');
const revokeObjectUrl = vi.fn();
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

function renderAndExport(json: unknown) {
  fetchExport.mockResolvedValue({ json: JSON.stringify(json), counts: { users: 1, candidates: 1 } });
  render(<I18nProvider><DataRequests /></I18nProvider>);
  fireEvent.change(screen.getByPlaceholderText(es.support.dataExportPlaceholder), {
    target: { value: 'a@b.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: es.support.dataExportButton }));
}

beforeEach(() => {
  fetchExport.mockReset();
  toastMock.mockReset();
  createObjectUrl.mockClear();
  revokeObjectUrl.mockClear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
  else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
  else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

describe('DSAR download follow-up state', () => {
  it.each([
    {
      name: 'a truncated event export',
      proctoring: {
        manualAccessRequired: true,
        manualAccessNotice: 'Revise manualmente los eventos truncados antes de cerrar la solicitud.',
        sessions: [],
        truncated: { assessmentConsents: false, sessions: false, events: true },
      },
    },
    {
      name: 'legacy session JSON that requires manual access',
      proctoring: {
        manualAccessRequired: true,
        manualAccessNotice: 'Revise manualmente los eventos heredados antes de cerrar la solicitud.',
        sessions: [{ legacyEventsManualAccessRequired: true }],
        truncated: { assessmentConsents: false, sessions: false, events: false },
      },
    },
  ])('downloads $name, shows the notice, and never claims completion', async ({ proctoring }) => {
    renderAndExport({ proctoring });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('a@b.com');
    expect(alert).toHaveTextContent(proctoring.manualAccessNotice);
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:dsar-test');
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
    expect(fetchExport).toHaveBeenCalledWith({ email: 'a@b.com' }, { staleTime: 0, gcTime: 0 });
    expect(toastMock).toHaveBeenCalledWith(proctoring.manualAccessNotice, { type: 'warning', duration: 8_000 });
    expect(toastMock.mock.calls.some((call) => call[1]?.type === 'success')).toBe(false);
  });

  it('still uses the success path for a verified complete export', async () => {
    renderAndExport({ proctoring: {
      manualAccessRequired: false,
      manualAccessNotice: null,
      sessions: [],
      truncated: { assessmentConsents: false, sessions: false, events: false },
    } });
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(
      `${es.support.dataExportDone}: 2`, { type: 'success' },
    ));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
  });

  it('treats an inconsistent partial marker as requiring follow-up', async () => {
    renderAndExport({ proctoring: {
      manualAccessRequired: false,
      manualAccessNotice: 'Revise manualmente los registros truncados.',
      sessions: [],
      truncated: { assessmentConsents: true, sessions: false, events: false },
    } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise manualmente');
    expect(toastMock.mock.calls.some((call) => call[1]?.type === 'success')).toBe(false);
  });

  it('treats a legacy-session marker as requiring follow-up even if the summary flag is false', async () => {
    renderAndExport({ proctoring: {
      manualAccessRequired: false,
      manualAccessNotice: 'Revise manualmente los eventos heredados.',
      sessions: [{ legacyEventsManualAccessRequired: true }],
      truncated: { assessmentConsents: false, sessions: false, events: false },
    } });
    expect(await screen.findByRole('alert')).toHaveTextContent('eventos heredados');
    expect(toastMock.mock.calls.some((call) => call[1]?.type === 'success')).toBe(false);
  });

  it('warns when an older or malformed export has no proctoring completeness marker', async () => {
    renderAndExport({ recruitment: { applications: [] } });
    expect(await screen.findByRole('alert')).toHaveTextContent(es.support.dataExportManualFollowUp);
    expect(toastMock.mock.calls.some((call) => call[1]?.type === 'success')).toBe(false);
  });
});
