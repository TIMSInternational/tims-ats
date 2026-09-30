import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { InterviewJoin } from '../../apps/web/app/interview/join/[token]/interview-join';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const copy = en.interviewJoin;
const fetchMock = vi.fn();
let assign: ReturnType<typeof vi.spyOn>;

function renderJoin(token = TOKEN) {
  localStorage.setItem('tims-locale', 'EN');
  document.documentElement.lang = 'en';
  return render(
    <I18nProvider>
      <InterviewJoin token={token} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  assign.mockRestore();
});

describe('InterviewJoin page', () => {
  it('ready + a Daily room URL → hands the candidate off to Daily', async () => {
    const joinUrl = 'https://tims.daily.co/tims-1234abcd?t=guest.token';
    fetchMock.mockResolvedValue(Response.json({ outcome: 'ready', joinUrl }));
    renderJoin();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(joinUrl));
    expect(screen.getByRole('heading', { name: copy.redirecting })).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/interview-join');
    expect(init.credentials).toBe('omit');
  });

  it.each(['https://evil.example/tims.daily.co', 'javascript:alert(1)//.daily.co', 'http://tims.daily.co/r'])(
    'ready + an unsafe URL (%s) → unavailable, never followed',
    async (joinUrl) => {
      fetchMock.mockResolvedValue(Response.json({ outcome: 'ready', joinUrl }));
      renderJoin();
      expect(await screen.findByRole('heading', { name: copy.unavailableTitle })).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it('a malformed token never calls the relay', async () => {
    renderJoin('short');
    expect(await screen.findByRole('heading', { name: copy.invalidTitle })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a dark platform route shows "contact the recruiter", not a bare "try again"', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: 'join_not_enabled' }, { status: 503 }));
    renderJoin();
    expect(await screen.findByRole('heading', { name: copy.notEnabledTitle })).toBeInTheDocument();
    expect(screen.getByText(copy.notEnabledText)).toBeInTheDocument();
  });

  it('429 shows "too many attempts" and keeps Retry disabled for Retry-After', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(
      Response.json({ error: 'rate_limited' }, { status: 429, headers: { 'retry-after': '30' } }),
    );
    renderJoin();
    expect(await screen.findByRole('heading', { name: copy.rateLimitedTitle })).toBeInTheDocument();
    const retry = screen.getByRole('button');
    expect(retry).toBeDisabled();
    expect(retry).toHaveTextContent(copy.retryIn.replace('{seconds}', '30'));
    fireEvent.click(retry);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throttles Retry: disabled for the cooldown after every answer, then re-checks once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockResolvedValue(Response.json({ outcome: 'unavailable' }));
    renderJoin();
    expect(await screen.findByRole('heading', { name: copy.unavailableTitle })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    const retry = screen.getByRole('button');
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});
