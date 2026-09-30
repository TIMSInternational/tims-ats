import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';

// ---------------------------------------------------------------------------
// PR #303 tier-3 finding: the AI tab toasted the raw server message for the
// blind-evaluation FORBIDDEN on generateSummary / detectBias — a hardcoded
// Spanish string (scorecard-visibility.service.ts) shown to EN users too. It now
// maps FORBIDDEN to i18n and disables those two buttons while the viewer is blinded.
// ---------------------------------------------------------------------------

type Opts = { onSuccess: (d: unknown) => void; onError: (e: { message: string; data?: { code?: string } }) => void };

const h = vi.hoisted(() => ({
  opts: {} as Record<string, Opts>,
  toast: (_m: string, _o?: unknown) => undefined as void,
}));
const toastSpy = vi.fn();

function mutationFor(name: string) {
  return {
    useMutation: (opts: Opts) => {
      h.opts[name] = opts;
      return { mutate: vi.fn(), isPending: false };
    },
  };
}

vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    interview: {
      generateGuide: mutationFor('guide'),
      generateSummary: mutationFor('summary'),
      detectBias: mutationFor('bias'),
    },
  },
}));
vi.mock('../../apps/web/lib/toast', () => ({ toast: (m: string, o?: unknown) => h.toast(m, o) }));

import { InterviewAiPanel } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/interview-ai-panel';

const INTERVIEW_ID = '33333333-3333-4333-8333-333333333333';
const SERVER_MSG = 'Envia tu evaluacion antes de ver las evaluaciones de los demas evaluadores';

function renderPanel(isViewerBlinded: boolean) {
  localStorage.setItem('tims-locale', 'EN');
  return render(
    <I18nProvider>
      <InterviewAiPanel interviewId={INTERVIEW_ID} isViewerBlinded={isViewerBlinded} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  toastSpy.mockReset();
  h.toast = toastSpy;
  h.opts = {};
});

describe('interview room AI tab — blind evaluation', () => {
  it('a blinded evaluator gets summary + bias disabled with a localized explanation; the guide stays usable', () => {
    renderPanel(true);
    expect(screen.getByRole('button', { name: en.interviews.generateSummary })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.interviews.detectBias })).toBeDisabled();
    expect(screen.getByRole('button', { name: en.interviews.generateGuide })).toBeEnabled();
    expect(screen.getByText(en.interviews.aiBlinded)).toBeInTheDocument();
  });

  it('an unblinded viewer gets every button enabled and no blind hint', () => {
    renderPanel(false);
    expect(screen.getByRole('button', { name: en.interviews.generateSummary })).toBeEnabled();
    expect(screen.getByRole('button', { name: en.interviews.detectBias })).toBeEnabled();
    expect(screen.queryByText(en.interviews.aiBlinded)).toBeNull();
  });

  it('maps the blind FORBIDDEN from summary and bias to the i18n string, never the raw server message', () => {
    renderPanel(true);
    for (const name of ['summary', 'bias']) {
      h.opts[name]?.onError({ message: SERVER_MSG, data: { code: 'FORBIDDEN' } });
      expect(toastSpy).toHaveBeenLastCalledWith(en.interviews.aiBlinded, { type: 'error' });
    }
    expect(toastSpy).not.toHaveBeenCalledWith(SERVER_MSG, expect.anything());
  });

  it('a FORBIDDEN for a viewer who is not blinded reads as a permission problem, not "submit first"', () => {
    renderPanel(false);
    h.opts.summary?.onError({ message: SERVER_MSG, data: { code: 'FORBIDDEN' } });
    expect(toastSpy).toHaveBeenLastCalledWith(en.interviews.aiForbidden, { type: 'error' });
  });

  it('other errors still surface their message', () => {
    renderPanel(false);
    h.opts.bias?.onError({ message: 'AI temporarily unavailable', data: { code: 'INTERNAL_SERVER_ERROR' } });
    expect(toastSpy).toHaveBeenLastCalledWith('AI temporarily unavailable', { type: 'error' });
  });
});
