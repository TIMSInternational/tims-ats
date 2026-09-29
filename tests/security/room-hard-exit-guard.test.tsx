/**
 * The interview room is served with a relaxed CSP (Daily call object). CSP is
 * per-DOCUMENT, so every exit from the room must be a full document load.
 *
 * Anchor clicks are covered by the capture-phase click handler. These tests
 * pin the backstop for PROGRAMMATIC exits — router.push/replace from the
 * navbar search (search-command.tsx) and the notification dropdown
 * (notification-dropdown.tsx) never produce an anchor click, but Next's App
 * Router commits every soft navigation through history.pushState/replaceState.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const hardNavigate = vi.fn<(path: string) => void>();

vi.mock('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/hard-exit', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../apps/web/app/(admin)/recruitment/interviews/[id]/room/hard-exit')>();
  return { ...actual, hardNavigate: (path: string) => hardNavigate(path) };
});

import { HardExitGuard } from '../../apps/web/app/(admin)/recruitment/interviews/[id]/room/hard-exit-guard';

const ROOM = '/recruitment/interviews/abc/room';

describe('HardExitGuard — programmatic (router.push / router.replace) exits', () => {
  beforeEach(() => {
    hardNavigate.mockReset();
    window.history.replaceState(null, '', ROOM);
  });

  afterEach(() => {
    cleanup();
  });

  it('turns a pushState that leaves the room (what router.push commits) into a full navigation', () => {
    render(<HardExitGuard />);
    // Shape of Next's internal commit: window.history.pushState({ __NA: true, ... }, '', href)
    window.history.pushState({ __NA: true }, '', '/recruitment/candidates/42');
    expect(hardNavigate).toHaveBeenCalledTimes(1);
    expect(hardNavigate).toHaveBeenCalledWith(`${window.location.origin}/recruitment/candidates/42`);
    // No history entry was committed: the document never soft-navigated away.
    expect(window.location.pathname).toBe(ROOM);
  });

  it('turns a replaceState that leaves the room (router.replace / redirect) into a full navigation', () => {
    render(<HardExitGuard />);
    window.history.replaceState({ __NA: true }, '', '/dashboard?tab=1');
    expect(hardNavigate).toHaveBeenCalledWith(`${window.location.origin}/dashboard?tab=1`);
    expect(window.location.pathname).toBe(ROOM);
  });

  it('lets same-path history writes through (query/hash updates, Next state writes)', () => {
    render(<HardExitGuard />);
    window.history.pushState({ __NA: true }, '', `${ROOM}?panel=notes`);
    window.history.replaceState({ __NA: true }, '', `${ROOM}#chat`);
    window.history.replaceState({ __NA: true }, '');
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(ROOM);
    expect(window.location.hash).toBe('#chat');
  });

  it('restores the original history methods on unmount', () => {
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    const { unmount } = render(<HardExitGuard />);
    expect(window.history.pushState).not.toBe(originalPush);
    unmount();
    expect(window.history.pushState).toBe(originalPush);
    expect(window.history.replaceState).toBe(originalReplace);
    window.history.pushState(null, '', '/elsewhere');
    expect(hardNavigate).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/elsewhere');
  });
});
