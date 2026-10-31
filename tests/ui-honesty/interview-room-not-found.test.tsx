import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { RoomNotFound } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/room-not-found';
import { shouldRetryInterviewQuery } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/room-load-error';

const trpcError = (code: string) => Object.assign(new Error('boom'), { data: { code } });

describe('interview room: unknown interview', () => {
  it('renders an explicit not-found state with a way back for a NOT_FOUND error', () => {
    render(<RoomNotFound error={trpcError('NOT_FOUND')} />);
    expect(screen.getByRole('alert').textContent).toContain(en.interviews.roomInterviewNotFound);
    expect(screen.getByText(en.interviews.roomInterviewNotFoundDesc)).toBeTruthy();
    const back = screen.getByRole('link', { name: en.interviews.roomBackToInterviews });
    expect(back.getAttribute('href')).toBe('/recruitment/interviews');
  });

  it('treats FORBIDDEN as not found (does not reveal that a foreign interview exists)', () => {
    render(<RoomNotFound error={trpcError('FORBIDDEN')} />);
    expect(screen.getByRole('alert').textContent).toContain(en.interviews.roomInterviewNotFound);
  });

  it('shows a generic load error, not the raw server message, for other failures', () => {
    render(<RoomNotFound error={trpcError('INTERNAL_SERVER_ERROR')} />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain(en.interviews.couldNotLoadInterview);
    expect(text).not.toContain('boom');
  });

  it('does not retry client errors, so the not-found state appears without a long blank wait', () => {
    expect(shouldRetryInterviewQuery(0, trpcError('NOT_FOUND'))).toBe(false);
    expect(shouldRetryInterviewQuery(0, trpcError('FORBIDDEN'))).toBe(false);
    expect(shouldRetryInterviewQuery(0, trpcError('BAD_REQUEST'))).toBe(false);
    expect(shouldRetryInterviewQuery(0, trpcError('INTERNAL_SERVER_ERROR'))).toBe(true);
    expect(shouldRetryInterviewQuery(3, trpcError('INTERNAL_SERVER_ERROR'))).toBe(false);
    expect(shouldRetryInterviewQuery(0, new Error('network'))).toBe(true);
  });
});
