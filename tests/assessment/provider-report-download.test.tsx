import { afterEach, describe, expect, it, vi } from 'vitest';

// The report download helper: the C# route template filled with the attempt, the variant only when there is one, and the
// saved file named after the test (never after anything the provider sent).

const mocks = vi.hoisted(() => ({ blob: vi.fn() }));
vi.mock('../../apps/web/lib/platform-api/client', async (original) => ({
  ...(await original<typeof import('../../apps/web/lib/platform-api/client')>()),
  platformGetBlob: mocks.blob,
}));

import { downloadProviderReport, reportFileName } from '../../apps/web/lib/platform-api/assessment-provider-reports';

afterEach(() => vi.restoreAllMocks());

describe('provider report download', () => {
  it('names the file after the test and the variant, stripping anything unexpected', () => {
    expect(reportFileName('lia', null)).toBe('tims-lia.pdf');
    expect(reportFileName('pca', 'gd')).toBe('tims-pca-gd.pdf');
    expect(reportFileName('pca', '../x"y')).toBe('tims-pca-xy.pdf');
  });

  it('fetches the attempt report with the variant only when there is one, and saves it', async () => {
    mocks.blob.mockResolvedValue(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    const createObjectURL = vi.fn(() => 'blob:report');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    await downloadProviderReport('a1', 'pca', 'gd');
    await downloadProviderReport('a2', 'lia', null);

    expect(mocks.blob).toHaveBeenNthCalledWith(1, '/assessments/provider-attempts/{attemptId}/report', { variant: 'gd' }, { attemptId: 'a1' });
    expect(mocks.blob).toHaveBeenNthCalledWith(2, '/assessments/provider-attempts/{attemptId}/report', undefined, { attemptId: 'a2' });
    expect(click).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('a[download]')).toHaveLength(0); // the link is removed after the click
  });
});
