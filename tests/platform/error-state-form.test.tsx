import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ErrorState } from '../../apps/web/components/error-state';
vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: { common: { error: 'Failed', retry: 'Retry' } } }) }));
it('retries the failed read without submitting its enclosing invitation form', () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const retry = vi.fn();
  const view = render(<form onSubmit={submit}><ErrorState onRetry={retry}/><button type="submit">Send invitation</button></form>);
  fireEvent.click(view.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Send invitation' }));
  expect(submit).toHaveBeenCalledOnce(); view.unmount();
});
