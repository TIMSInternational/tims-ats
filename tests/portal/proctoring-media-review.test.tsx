import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../apps/web/lib/i18n';
import en from '../../apps/web/lib/i18n/en.json';

const mutate = vi.fn();
let items: unknown[] = [];
vi.mock('../../apps/web/lib/platform-api/proctoring-staff', () => ({
  useProctoringMedia: () => ({ isLoading: false, isError: false, data: { mediaConsented: true, items } }),
  useProctoringMediaReadGrant: () => ({ mutate, isPending: false, isError: false }),
}));

import { ProctoringMediaReview } from '../../apps/web/app/(admin)/recruitment/candidates/[id]/proctoring-media-review';

const assignmentId = '11111111-1111-4111-8111-111111111111';
const evidenceId = '22222222-2222-4222-8222-222222222222';

function renderReview() {
  localStorage.setItem('tims-locale', 'EN');
  return render(<I18nProvider><ProctoringMediaReview assignmentId={assignmentId} /></I18nProvider>);
}

describe('sampled proctoring evidence review', () => {
  beforeEach(() => {
    mutate.mockReset();
    items = [{
      evidenceId, mediaType: 'camera', captureReason: 'periodic', status: 'processed',
      createdAt: '2026-09-24T12:00:00Z', confirmedAt: '2026-09-24T12:00:02Z',
      expiresAt: new Date(Date.now() + 60_000).toISOString(), findings: [{
        detector: 'rekognition_detect_faces', label: 'face_count', resultKind: 'signal',
        detectedCount: 1,
      }],
    }];
  });

  it('opens a media URL only after an explicit reviewer action', () => {
    renderReview();
    expect(screen.getByText(`${en.proctoring.review.media.faceCount}: 1`)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: en.proctoring.review.media.view }));
    expect(mutate).toHaveBeenCalledWith({ assignmentId, evidenceId }, expect.any(Object));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('does not offer a read grant for expired evidence', () => {
    items = [{ ...items[0] as object, status: 'expired',
      expiresAt: '2026-09-20T12:00:00Z' }];
    renderReview();
    expect(screen.getByText(en.proctoring.review.media.expired)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.proctoring.review.media.view }))
      .not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('labels unavailable analysis distinctly from an image with no observations', () => {
    items = [{ ...items[0] as object, status: 'unavailable', findings: [] }];
    renderReview();
    expect(screen.getByText(en.proctoring.review.media.unavailable)).toBeInTheDocument();
    expect(screen.queryByText(en.proctoring.review.media.noFindings)).not.toBeInTheDocument();
  });
});
