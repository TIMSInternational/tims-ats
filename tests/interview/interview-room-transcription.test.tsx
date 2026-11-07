import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import { RoomLobby } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/room-lobby';
import { TranscriptionNotice } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/transcription-notice';
import { TranscriptAiResult } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/transcript-ai-result';
import type { TranscriptAnalysisView } from '../../apps/web/lib/interview-transcription';

const copy = es.interviewTranscription;
const wrap = ({ children }: { children: ReactNode }) => {
  localStorage.setItem('tims-locale', 'ES');
  return <I18nProvider>{children}</I18nProvider>;
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('staff lobby notice', () => {
  it('blocks joining until the evaluator accepts the notice', () => {
    const onJoin = vi.fn();
    const Lobby = ({ accepted }: { accepted: boolean }) => (
      <RoomLobby
        candidateName="Ana"
        candidateInitials="A"
        subtitle="Analista"
        isJoining={false}
        joinErrorMessage={null}
        onJoin={onJoin}
        onScoreWithoutVideo={vi.fn()}
        notice={<TranscriptionNotice accepted={accepted} onAcceptedChange={vi.fn()} />}
        joinBlocked={!accepted}
      />
    );
    const view = render(<Lobby accepted={false} />, { wrapper: wrap });
    const join = screen.getByRole('button', { name: es.interviews.roomJoin });
    expect(join).toBeDisabled();
    expect(screen.getByText(copy.noticeBody)).toBeInTheDocument();
    view.rerender(<Lobby accepted />);
    expect(screen.getByRole('button', { name: es.interviews.roomJoin })).toBeEnabled();
  });

  it('is absent, and never blocks, while transcription is dark', async () => {
    const { useTranscriptionNotice } =
      await import('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/transcription-notice');
    const { result } = renderHook(() => useTranscriptionNotice('i1', true), { wrapper: wrap });
    expect(result.current.enabled).toBe(false);
    expect(result.current.mayJoin).toBe(true);
  });

  it('with the flags on, requires the tick and records the acknowledgement once', async () => {
    vi.stubEnv('NEXT_PUBLIC_INTERVIEW_VIDEO_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_INTERVIEW_TRANSCRIPTION_ENABLED', 'true');
    vi.stubEnv('NEXT_PUBLIC_TIMS_PLATFORM_API_URL', 'https://api.example.test');
    vi.resetModules();
    vi.doMock('@tims/auth/client', () => ({
      createSupabaseBrowserClient: () => ({
        auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
      }),
    }));
    const status = {
      consentVersion: 'interview-transcription-2026-11-06',
      candidateDecision: 'pending',
      candidateDecidedAt: null,
      viewerAcknowledged: true,
      transcriptState: 'none',
      transcriptAvailable: false,
      canStart: false,
    };
    const fetchMock = vi.fn(async () => Response.json(status));
    vi.stubGlobal('fetch', fetchMock);
    const { I18nProvider: FreshProvider } = await import('../../apps/web/lib/i18n');
    const { useTranscriptionNotice } =
      await import('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/transcription-notice');
    const { result } = renderHook(() => useTranscriptionNotice('i1', true), {
      wrapper: ({ children }) => <FreshProvider>{children}</FreshProvider>,
    });
    expect(result.current.enabled).toBe(true);
    expect(result.current.mayJoin).toBe(false);
    await act(async () => result.current.record()); // not accepted yet: nothing is recorded
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => result.current.setAccepted(true));
    expect(result.current.mayJoin).toBe(true);
    await act(async () => result.current.record());
    await act(async () => result.current.record());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/platform/tenant/interviews/i1/transcription/acknowledgement');
    expect(JSON.parse(String(init.body))).toEqual({ consentVersion: 'interview-transcription-2026-11-06' });
  });
});

const analysis: TranscriptAnalysisView = {
  summary: 'Habló de SQL y de clientes.',
  questions: [
    {
      question: '¿Qué herramientas usa?',
      askedAtSeconds: 70,
      answerSummary: 'SQL a diario.',
      answerQuote: 'Uso SQL a diario',
    },
  ],
  competencies: [
    {
      key: 'SQL',
      label: 'SQL',
      suggestedRating: 3,
      rationale: 'Uso diario.',
      evidence: [{ quote: 'Uso SQL a diario', atSeconds: 78 }],
    },
    {
      key: 'communication',
      label: 'Comunicación',
      suggestedRating: null,
      rationale: '',
      evidence: [{ quote: 'primero escucho al cliente', atSeconds: 12 }],
    },
  ],
  limitations: ['Transcripción corta.'],
  degraded: false,
  truncated: false,
};

describe('transcript AI result', () => {
  it('shows every suggestion with its verbatim evidence and copies on request only', () => {
    const onApply = vi.fn();
    render(<TranscriptAiResult analysis={analysis} onApply={onApply} />, { wrapper: wrap });
    expect(screen.getByText(copy.suggestedRating.replace('{n}', '3'))).toBeInTheDocument();
    expect(screen.getByText(copy.noRating)).toBeInTheDocument();
    expect(screen.getAllByText(/\[01:18\]/).length).toBeGreaterThan(0);
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: copy.applyToScorecard })[0]!);
    expect(onApply).toHaveBeenCalledWith({
      key: 'SQL',
      rating: 3,
      noteLines: ['[IA · SQL] «Uso SQL a diario» (01:18)'],
    });
  });
});

describe('transcript AI card', () => {
  beforeEach(() => vi.resetModules());

  it('labels the panel as an AI suggestion and maps a budget refusal to its own message', async () => {
    const { PlatformApiError } = await import('../../apps/web/lib/platform-api/client');
    vi.doMock('../../apps/web/lib/platform-api/interview-transcription', () => ({
      useTranscriptionStatus: () => ({ data: { transcriptAvailable: true }, isError: false }),
      requestTranscriptAnalysis: async () => {
        throw new PlatformApiError(429, 'Too Many Requests', { code: 'ai_budget_exceeded' });
      },
    }));
    const { TranscriptAiCard } =
      await import('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/transcript-ai-card');
    const { I18nProvider: FreshProvider } = await import('../../apps/web/lib/i18n');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FreshProvider>
          <TranscriptAiCard interviewId="i1" />
        </FreshProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText(copy.aiDisclaimer)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: copy.analyze }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(copy.errorBudget));
  });
});
