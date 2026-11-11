import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import {
  ProviderAssessmentFrame,
  isSittingEndedMessage,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-frame';

// The full-screen frame of a TIMS test in the candidate portal: the player's "sitting ended" message is trusted only
// from the player origin; leaving always asks; the PCA is framed with timssuite.com's own header and sandbox.
const m = en.portalDashboard;
const ended = { source: 'tims-hosted-player', v: 1, type: 'sitting_ended', reason: 'finished' };
const message = (data: unknown, origin: string) => new MessageEvent('message', { data, origin });

function renderFrame(props: Partial<React.ComponentProps<typeof ProviderAssessmentFrame>> = {}) {
  const onClose = vi.fn();
  const onFinished = vi.fn();
  localStorage.setItem('tims-locale', 'EN');
  render(
    <I18nProvider>
      <ProviderAssessmentFrame
        url="https://player.test/hosted/x"
        name="Cognitive skills"
        playerOrigin="https://player.test"
        onClose={onClose}
        onFinished={onFinished}
        {...props}
      />
    </I18nProvider>,
  );
  return { onClose, onFinished };
}

describe('isSittingEndedMessage', () => {
  it('accepts only the player origin and the player message shape', () => {
    expect(isSittingEndedMessage(message(ended, 'https://player.test'), 'https://player.test')).toBe(true);
    expect(isSittingEndedMessage(message(ended, 'https://evil.test'), 'https://player.test')).toBe(false);
    expect(isSittingEndedMessage(message({ type: 'sitting_ended' }, 'https://player.test'), 'https://player.test')).toBe(false);
    expect(isSittingEndedMessage(message('sitting_ended', 'https://player.test'), 'https://player.test')).toBe(false);
    expect(isSittingEndedMessage(message(ended, 'https://player.test'), undefined)).toBe(false);
  });
});

describe('ProviderAssessmentFrame', () => {
  it('reports the end of the sitting when the player says so', () => {
    const { onFinished } = renderFrame();
    window.dispatchEvent(message(ended, 'https://evil.test'));
    expect(onFinished).not.toHaveBeenCalled();
    window.dispatchEvent(message(ended, 'https://player.test'));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('asks before leaving, from the button or Escape, and staying is the default', () => {
    const { onClose } = renderFrame();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toHaveTextContent(m.providerLeaveTitle);
    expect(screen.getByRole('button', { name: m.providerLeaveStay })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: m.providerFrameLeave }));
    fireEvent.click(screen.getByRole('button', { name: m.providerLeaveConfirm }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('frames the PCA as timssuite.com does: its header, forms and scripts on its own origin, no popups or devices', () => {
    renderFrame({ url: 'https://timshr.test/s/1', sandboxed: true, name: 'PCA' });
    expect(screen.getByRole('heading', { name: m.providerPcaFrameTitle })).toBeInTheDocument();
    expect(screen.getByText(m.providerPcaFrameHint)).toBeInTheDocument();
    const frame = screen.getByTitle('PCA');
    expect(frame.getAttribute('sandbox')).toBe('allow-forms allow-scripts allow-same-origin');
    expect(frame.getAttribute('allow')).toBe('fullscreen');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });
});
