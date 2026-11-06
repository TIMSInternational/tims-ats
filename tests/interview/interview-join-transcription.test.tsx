import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

const callProps = vi.hoisted(() => ({ last: null as null | { joinUrl: string; decision: string | null } }));
vi.mock('../../apps/web/app/interview/join/[token]/candidate-call', () => ({
  CandidateCall: (props: { joinUrl: string; decision: string | null }) => {
    callProps.last = props;
    return <div data-testid="in-app-call">{props.decision ?? 'no-transcription'}</div>;
  },
}));

import { InterviewJoin } from '../../apps/web/app/interview/join/[token]/interview-join';
import { INTERVIEW_TRANSCRIPTION_CONSENT_VERSION } from '../../apps/web/lib/interview-transcription';
import { splitJoinUrl } from '../../apps/web/lib/interview-join';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';
const JOIN_URL = 'https://tims.daily.co/tims-1234abcd000040008000000000000001?t=guest.token';
const copy = es.interviewJoinTranscription;
const fetchMock = vi.fn();
let assign: ReturnType<typeof vi.spyOn>;

function renderJoin() {
  localStorage.setItem('tims-locale', 'ES');
  return render(
    <I18nProvider>
      <InterviewJoin token={TOKEN} />
    </I18nProvider>,
  );
}

const sentBodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)));

beforeEach(() => {
  fetchMock.mockReset();
  callProps.last = null;
  vi.stubGlobal('fetch', fetchMock);
  assign = vi.spyOn(window.location, 'assign').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  assign.mockRestore();
});

describe('candidate transcription consent', () => {
  it('asks before any room exists, then records the answer with the notice version', async () => {
    vi.stubEnv('NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED', 'true');
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ outcome: 'consent_required', consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION }),
      )
      .mockResolvedValueOnce(
        Response.json({ outcome: 'ready', joinUrl: JOIN_URL, consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION }),
      );
    renderJoin();
    expect(await screen.findByRole('heading', { name: copy.consentTitle })).toBeInTheDocument();
    // Both choices are equally available and the notice says declining has no consequence.
    expect(screen.getByText(copy.consentFree)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy.decline }));
    expect(await screen.findByTestId('in-app-call')).toHaveTextContent('declined');
    expect(sentBodies()).toEqual([
      { token: TOKEN },
      { token: TOKEN, recordingConsent: 'declined', consentVersion: INTERVIEW_TRANSCRIPTION_CONSENT_VERSION },
    ]);
    expect(assign).not.toHaveBeenCalled();
    expect(callProps.last?.joinUrl).toBe(JOIN_URL);
  });

  it('an unknown notice version (deploy skew) is never consented to', async () => {
    fetchMock.mockResolvedValue(Response.json({ outcome: 'consent_required', consentVersion: 'some-other-version' }));
    renderJoin();
    expect(await screen.findByRole('heading', { name: es.interviewJoin.unavailableTitle })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: copy.accept })).not.toBeInTheDocument();
  });

  it('with in-app video off, a ready join still hands off to the Daily page (unchanged behavior)', async () => {
    fetchMock.mockResolvedValue(Response.json({ outcome: 'ready', joinUrl: JOIN_URL }));
    renderJoin();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(JOIN_URL));
    expect(screen.queryByTestId('in-app-call')).not.toBeInTheDocument();
  });

  it('with in-app video on and transcription off, the call opens in the platform without a notice', async () => {
    vi.stubEnv('NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED', 'true');
    fetchMock.mockResolvedValue(Response.json({ outcome: 'ready', joinUrl: JOIN_URL }));
    renderJoin();
    expect(await screen.findByTestId('in-app-call')).toHaveTextContent('no-transcription');
    expect(sentBodies()).toEqual([{ token: TOKEN }]);
  });
});

describe('splitJoinUrl', () => {
  it('separates the room URL from its guest token', () => {
    expect(splitJoinUrl(JOIN_URL)).toEqual({
      url: 'https://tims.daily.co/tims-1234abcd000040008000000000000001',
      token: 'guest.token',
    });
    expect(splitJoinUrl('https://tims.daily.co/r').token).toBeNull();
  });
});
