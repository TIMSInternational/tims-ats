import React from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  toast: vi.fn(),
  getUploadUrl: vi.fn(),
  record: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  canUpdate: { value: true },
}));

vi.mock('../../apps/web/lib/i18n', async () => {
  const { default: t } = await import('../../apps/web/lib/i18n/es.json');
  return { useI18n: () => ({ t, locale: 'es' }) };
});
vi.mock('../../apps/web/lib/toast', () => ({ toast: mocks.toast }));
vi.mock('../../apps/web/lib/permissions', () => ({
  useCan: () => (module: string, action?: string) => !(module === 'candidate' && action === 'update') || mocks.canUpdate.value,
}));
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      candidate: { getById: { invalidate: mocks.invalidate }, getTimeline: { invalidate: mocks.invalidate } },
    }),
    candidate: {
      getDocumentUrl: {
        useMutation: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, variables: undefined }),
      },
      getDocumentUploadUrl: { useMutation: () => ({ mutateAsync: mocks.getUploadUrl, isPending: false }) },
      uploadDocument: { useMutation: () => ({ mutateAsync: mocks.record, isPending: false }) },
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
  mocks.canUpdate.value = true;
});

afterEach(() => {
  openSpy?.mockRestore();
});

describe('DocumentsCard', () => {
  it('offers "Subir documento" only to staff who may update the candidate (A-21)', () => {
    mocks.canUpdate.value = false;
    const { unmount } = render(<DocumentsCard documents={[DOC]} candidateId={CANDIDATE_ID} />);
    expect(screen.queryByText(es.candidates.uploadDocument)).toBeNull();
    unmount();
    mocks.canUpdate.value = true;
    render(<DocumentsCard documents={[DOC]} candidateId={CANDIDATE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: es.candidates.uploadDocument }));
    expect(screen.getByLabelText(es.candidates.documentTypeLabel)).toBeTruthy();
    expect(screen.getByLabelText(es.candidates.documentFileLabel)).toBeTruthy();
  });

  it('uploads through the presigned POST, then records the stored key on the candidate', async () => {
    mocks.getUploadUrl.mockResolvedValue({ url: 'https://bucket.example.test', fields: { key: 'k', policy: 'p' }, key: 'cv-uploads/org/new.pdf' });
    mocks.record.mockResolvedValue({ id: 'doc-2' });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    render(<DocumentsCard documents={[]} candidateId={CANDIDATE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: es.candidates.uploadDocument }));
    fireEvent.change(screen.getByLabelText(es.candidates.documentTypeLabel), { target: { value: 'certificate' } });
    const file = new File(['%PDF-1.4'], 'titulo.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(es.candidates.documentFileLabel), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: es.candidates.documentUploadSubmit }));

    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(mocks.getUploadUrl).toHaveBeenCalledWith({ candidateId: CANDIDATE_ID, contentType: 'application/pdf' });
    expect(fetchSpy).toHaveBeenCalledWith('https://bucket.example.test', expect.objectContaining({ method: 'POST' }));
    expect(mocks.record).toHaveBeenCalledWith({
      candidateId: CANDIDATE_ID,
      type: 'certificate',
      fileName: 'titulo.pdf',
      fileKey: 'cv-uploads/org/new.pdf',
    });
    expect(mocks.toast).toHaveBeenCalledWith(es.candidates.documentUploaded, { type: 'success' });
    fetchSpy.mockRestore();
  });

  it('refuses a file that is not PDF or DOCX before asking for an upload URL', () => {
    render(<DocumentsCard documents={[]} candidateId={CANDIDATE_ID} />);
    fireEvent.click(screen.getByRole('button', { name: es.candidates.uploadDocument }));
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(es.candidates.documentFileLabel), { target: { files: [file] } });
    expect(screen.getByRole('alert').textContent).toBe(es.candidates.documentFileInvalidType);
    fireEvent.click(screen.getByRole('button', { name: es.candidates.documentUploadSubmit }));
    expect(mocks.getUploadUrl).not.toHaveBeenCalled();
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
