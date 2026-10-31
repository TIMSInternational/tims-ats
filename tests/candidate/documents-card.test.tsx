import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    candidate: {
      getDocumentUrl: {
        useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, variables: undefined }),
      },
    },
  },
}));

import { DocumentsCard } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/documents-card';

const CANDIDATE_ID = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';
const DOC = {
  id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a40',
  type: 'cv',
  fileName: 'cv-ana.pdf',
  fileUrl: 'cv-uploads/org/obj.pdf',
  fileSize: 1000,
  parsedData: null,
  uploadedAt: new Date().toISOString(),
};

function fakeTab() {
  return { opener: {} as unknown, closed: false, close: vi.fn(), location: { replace: vi.fn() } };
}

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  openSpy?.mockRestore();
});

describe('DocumentsCard', () => {
  it('has no dead "Upload document" button', () => {
    render(<DocumentsCard documents={[DOC]} candidateId={CANDIDATE_ID} />);
    expect(screen.queryByText(es.candidates.uploadDocument)).toBeNull();
  });

  it('opens the signed link in a new tab with the opener severed', async () => {
    const tab = fakeTab();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    mocks.mutateAsync.mockResolvedValue({ url: 'https://bucket.s3.amazonaws.com/signed', expiresInSeconds: 300 });

    render(<DocumentsCard documents={[DOC]} candidateId={CANDIDATE_ID} />);
    fireEvent.click(
      screen.getByRole('button', { name: es.candidates.openDocumentAria.replace('{name}', DOC.fileName) }),
    );

    // The tab is reserved synchronously inside the click (popup blockers), before the request resolves.
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull();
    await waitFor(() => expect(tab.location.replace).toHaveBeenCalledWith('https://bucket.s3.amazonaws.com/signed'));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ candidateId: CANDIDATE_ID, documentId: DOC.id });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it.each([
    ['NOT_FOUND', es.candidates.documentUnavailable],
    ['PRECONDITION_FAILED', es.candidates.documentUnavailable],
    ['FORBIDDEN', es.candidates.documentForbidden],
    ['INTERNAL_SERVER_ERROR', es.candidates.documentOpenFailed],
  ])('on %s closes the reserved tab and shows a localized error', async (code, message) => {
    const tab = fakeTab();
    openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    mocks.mutateAsync.mockRejectedValue(Object.assign(new Error('raw server text'), { data: { code } }));

    render(<DocumentsCard documents={[DOC]} candidateId={CANDIDATE_ID} />);
    fireEvent.click(
      screen.getByRole('button', { name: es.candidates.openDocumentAria.replace('{name}', DOC.fileName) }),
    );

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(message, { type: 'error' }));
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });
});
