import { useEffect } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real package (no mock): what matters here is the order of its command queue in a browser-like DOM.
// The package resolves from apps/web (the repo root has no copy of its own).
import { track } from '../../apps/web/node_modules/@vercel/analytics';
import { WebAnalytics } from '../../apps/web/components/web-analytics';
import { scrubAnalyticsEvent, trackCareersFunnel } from '../../apps/web/lib/analytics/web-analytics';

// Before its script has loaded, the package keeps commands in window.vaq; the script replays them in order.
type QueuedCommand = [string, unknown?];
type AnalyticsGlobals = { va?: unknown; vaq?: QueuedCommand[]; vam?: unknown };

function analyticsGlobals(): AnalyticsGlobals {
  return window as unknown as AnalyticsGlobals;
}

function queuedCommands(): QueuedCommand[] {
  return analyticsGlobals().vaq ?? [];
}

/** A careers board: records the funnel step in its mount effect, as job-board.tsx does. */
function Board() {
  useEffect(() => trackCareersFunnel('careers_view', 'acme', true), []);
  return null;
}

/** The same board calling the package directly, with no wait for the queue. */
function BoardWithoutDeferral() {
  useEffect(() => track('careers_view', { org: 'acme' }), []);
  return null;
}

beforeEach(() => {
  const globals = analyticsGlobals();
  delete globals.va;
  delete globals.vaq;
  delete globals.vam;
  document.head.innerHTML = '';
  // The test DOM never loads external scripts (it prints its own notice for that). The package reports the
  // failed load through console.log, which is expected; a React error through console.error fails the test.
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  const errors = vi.mocked(console.error).mock.calls.map((args) => String(args[0]));
  vi.restoreAllMocks();
  expect(errors).toEqual([]);
});

describe('careers funnel events on a full page load (root layout order: page first, analytics after)', () => {
  it('a step recorded before <WebAnalytics/> mounts is queued after the scrubber, not lost', async () => {
    render(
      <>
        <Board />
        <WebAnalytics />
      </>,
    );

    await waitFor(() => expect(queuedCommands().some(([command]) => command === 'event')).toBe(true));
    const commands = queuedCommands();
    const beforeSendAt = commands.findIndex(([command]) => command === 'beforeSend');
    const eventAt = commands.findIndex(([command]) => command === 'event');
    expect(beforeSendAt).toBeGreaterThanOrEqual(0);
    expect(beforeSendAt).toBeLessThan(eventAt);
    expect(commands[beforeSendAt]?.[1]).toBe(scrubAnalyticsEvent);
    expect(commands[eventAt]?.[1]).toEqual({ name: 'careers_view', data: { org: 'acme' }, options: undefined });
    expect(commands.filter(([command]) => command === 'event')).toHaveLength(1);
  });

  it('control: calling the package directly in that order loses the step', async () => {
    render(
      <>
        <BoardWithoutDeferral />
        <WebAnalytics />
      </>,
    );

    await waitFor(() => expect(queuedCommands().some(([command]) => command === 'beforeSend')).toBe(true));
    expect(queuedCommands().some(([command]) => command === 'event')).toBe(false);
  });
});
