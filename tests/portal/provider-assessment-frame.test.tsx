import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { I18nProvider } from '../../apps/web/lib/i18n';
import {
  ProviderAssessmentFrame,
  isSittingEndedMessage,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/provider-assessment-frame';

// The full-screen frame of a TIMS test in the candidate portal: the player's "sitting ended" message is trusted only
// from the player origin; leaving always asks; every test (the PCA included) gets the same bar and a loading state; the
// PCA is framed in timssuite.com's sandbox, with a way to open it in a new tab.
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
    expect(
      isSittingEndedMessage(message({ type: 'sitting_ended' }, 'https://player.test'), 'https://player.test'),
    ).toBe(false);
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

  it('while it asks, the bar and the test are inert behind a modal alertdialog; staying returns focus to Leave', () => {
    renderFrame();
    const header = screen.getByText('Cognitive skills', { selector: 'p' }).parentElement!.parentElement!;
    const body = screen.getByTitle('Cognitive skills').parentElement!;
    const leave = screen.getByRole('button', { name: m.providerFrameLeave });
    expect(header).not.toHaveAttribute('inert');
    expect(body).not.toHaveAttribute('inert');
    fireEvent.click(leave);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // The question is a heading (screen-reader navigation), under the PCA warn eyebrow.
    expect(within(dialog).getByRole('heading', { level: 2, name: m.providerLeaveTitle })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(m.providerLeaveEyebrow);
    expect(header).toHaveAttribute('inert');
    expect(body).toHaveAttribute('inert');
    // Stay: the scrim goes, nothing is inert, focus is back on the way out it came from.
    fireEvent.click(screen.getByRole('button', { name: m.providerLeaveStay }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(header).not.toHaveAttribute('inert');
    expect(body).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: m.providerFrameLeave })).toHaveFocus();
    // Escape asks, a second Escape stays: focus returns to Leave the same way.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: m.providerLeaveStay })).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: m.providerFrameLeave })).toHaveFocus();
  });

  it('keeps keyboard focus inside the leave question: Tab and Shift+Tab cycle between its two buttons', () => {
    // The question is drawn inline in the dashboard (not in the top layer), so without this Tab would reach the page
    // hidden under the scrim.
    renderFrame();
    fireEvent.click(screen.getByRole('button', { name: m.providerFrameLeave }));
    const stay = screen.getByRole('button', { name: m.providerLeaveStay });
    const confirm = screen.getByRole('button', { name: m.providerLeaveConfirm });
    expect(stay).toHaveFocus();
    // Tab from Stay (the last button) wraps to Confirm; Shift+Tab from Confirm (the first) wraps to Stay.
    expect(fireEvent.keyDown(stay, { key: 'Tab' })).toBe(false);
    expect(confirm).toHaveFocus();
    expect(fireEvent.keyDown(confirm, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(stay).toHaveFocus();
    // Between the two the browser moves focus on its own: nothing is prevented.
    confirm.focus();
    expect(fireEvent.keyDown(confirm, { key: 'Tab' })).toBe(true);
    // Focus that fell to the page body (a click on the scrim) comes back in, in either direction.
    confirm.blur();
    expect(document.body).toHaveFocus();
    fireEvent.keyDown(document.body, { key: 'Tab' });
    expect(confirm).toHaveFocus();
    confirm.blur();
    fireEvent.keyDown(document.body, { key: 'Tab', shiftKey: true });
    expect(stay).toHaveFocus();
    // Once the question is answered, Tab is the browser's again.
    fireEvent.click(stay);
    const leave = screen.getByRole('button', { name: m.providerFrameLeave });
    expect(leave).toHaveFocus();
    expect(fireEvent.keyDown(leave, { key: 'Tab' })).toBe(true);
    expect(leave).toHaveFocus();
  });

  it('is the one header over the hosted player: brand, test name and the way out, in one bar', () => {
    renderFrame();
    const bar = screen.getByRole('button', { name: m.providerFrameLeave }).parentElement!.parentElement!;
    expect(within(bar).getByText(m.providerFrameBrand)).toBeInTheDocument();
    expect(within(bar).getByText('Cognitive skills')).toBeInTheDocument();
    expect(screen.getAllByText(m.providerFrameBrand)).toHaveLength(1);
    // The player draws no header inside the frame: its sheet (and so the loading sheet) starts right under the bar.
    expect(screen.getByRole('status').className).not.toMatch(/(^|\s)(md:)?pt-/);
  });

  it('brands the sandboxed provider page the same way, which has no TIMS header of its own', () => {
    renderFrame({ url: 'https://timshr.test/s/1', sandboxed: true });
    expect(screen.getAllByText(m.providerFrameBrand)).toHaveLength(1);
    expect(screen.getByRole('status').className).not.toMatch(/(^|\s)(md:)?pt-/);
  });

  it('after the end, offers one way back that does not ask; Escape returns too', () => {
    const { onClose } = renderFrame({ finished: true });
    expect(screen.queryByRole('button', { name: m.providerFrameLeave })).not.toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: m.providerFrameDone }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('frames the PCA in the same bar as every test, sandboxed as timssuite.com does: forms and scripts on its own origin, no popups or devices', () => {
    renderFrame({ url: 'https://timshr.test/s/1', sandboxed: true, name: 'Behavioral profile' });
    const dialog = screen.getByRole('dialog', { name: 'Behavioral profile' });
    // The ATS bar (the test's name and the way out), not a second header of its own.
    expect(within(dialog).queryByRole('heading')).not.toBeInTheDocument();
    expect(within(dialog).getByText('Behavioral profile', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: m.providerFrameLeave })).toBeInTheDocument();
    const frame = screen.getByTitle('Behavioral profile');
    expect(frame.getAttribute('sandbox')).toBe('allow-forms allow-scripts allow-same-origin');
    expect(frame.getAttribute('allow')).toBe('fullscreen');
    expect(frame.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  });

  it('offers to open the PCA in a new tab, outside the sandbox, and keeps the frame', () => {
    const { onClose } = renderFrame({ url: 'https://timshr.test/s/1', sandboxed: true, name: 'Behavioral profile' });
    const link = screen.getByRole('link', { name: m.providerFrameNewTab });
    expect(link).toHaveAttribute('href', 'https://timshr.test/s/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(link);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTitle('Behavioral profile')).toBeInTheDocument();
  });

  it('never offers a new tab for the hosted player, whose launch code the frame has spent', () => {
    renderFrame();
    expect(screen.queryByRole('link', { name: m.providerFrameNewTab })).not.toBeInTheDocument();
  });

  it.each([
    ['the hosted player', {}],
    ['the PCA', { url: 'https://timshr.test/s/1', sandboxed: true }],
  ])('shows what is opening until %s has loaded, without blocking the page', (_kind, props) => {
    renderFrame(props);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(m.providerFrameOpening.replace('{name}', 'Cognitive skills'));
    expect(status.className).toContain('pointer-events-none');
    const frame = screen.getByTitle('Cognitive skills');
    fireEvent.load(frame);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Later navigations inside the frame (the survey's own pages) never bring it back.
    fireEvent.load(frame);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('speaks the language of the test, not the portal language', () => {
    // The portal is in English (renderFrame sets EN); the test is administered in Spanish.
    renderFrame({ locale: 'es' });
    fireEvent.click(screen.getByRole('button', { name: es.portalDashboard.providerFrameLeave }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(es.portalDashboard.providerLeaveTitle);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(es.portalDashboard.providerLeaveBody);
  });

  it('falls back to the portal language for a test locale it has no strings for', () => {
    renderFrame({ locale: 'pt' });
    expect(screen.getByRole('button', { name: m.providerFrameLeave })).toBeInTheDocument();
  });
});
