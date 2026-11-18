import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

// Round 5 (owner 2026-11-16): the candidate dashboard in the TIMS evaluation design. The section rewrites lean on these
// dashboard-local PCA primitives keeping the contracts the shared components had (the e2e and the unit tests find the
// consent guide, the full-text sheet and the confirm dialogs by them), so they are pinned here, behaviour only.

vi.mock('../../apps/web/lib/i18n', async (original) => {
  const { default: en } = await import('../../apps/web/lib/i18n/en.json');
  return {
    ...(await original<typeof import('../../apps/web/lib/i18n')>()),
    useI18n: () => ({ t: en, locale: 'EN' }),
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@tims/auth/client', () => ({ createSupabaseBrowserClient: () => ({ auth: { signOut: vi.fn() } }) }));

import en from '../../apps/web/lib/i18n/en.json';
import es from '../../apps/web/lib/i18n/es.json';
import { EvalStepHead } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/eval-step-head';
import { EvalSheet } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/eval-sheet';
import { EvalAlertDialog } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/eval-alert-dialog';
import { EvalCheckboxRow } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/eval-checkbox-row';
import { EvalButton } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/eval-button';
import { PortalDashboardShell } from '../../apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-shell';

const pd = en.portalDashboard;

describe('the dashboard PCA primitives keep the old contracts', () => {
  it('the step head says "Step n of N · label" and keeps the Steps navigation with aria-current', () => {
    render(<EvalStepHead steps={['Notice', 'Consent', 'Start']} current={1} />);
    expect(screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === 'Step 2 of 3 · Consent')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: en.common.steps });
    const items = within(nav).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1]?.getAttribute('aria-current')).toBe('step');
    expect(items[0]?.textContent).toBe(`Notice (${en.common.stepDone})`);
    const bar = within(nav).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('3');
  });

  it('the sheet is a named modal dialog; every Close closes it and the last one is at the end', () => {
    const onClose = vi.fn();
    render(
      <EvalSheet title="Notice" closeLabel={en.common.close} onClose={onClose}>
        <div tabIndex={0} data-autofocus data-testid="consent-full-text">
          Full text
        </div>
      </EvalSheet>,
    );
    const sheet = screen.getByRole('dialog', { name: 'Notice' });
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    const closes = within(sheet).getAllByRole('button', { name: en.common.close });
    expect(closes.length).toBeGreaterThanOrEqual(1);
    const last = closes[closes.length - 1]!;
    expect(last.compareDocumentPosition(within(sheet).getByTestId('consent-full-text'))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    fireEvent.click(last);
    fireEvent.click(closes[0]!);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('the confirm dialog keeps role="dialog" by default, is named by its question and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <EvalAlertDialog
        tone="danger"
        icon={null}
        title="Withdraw your application?"
        body="This cannot be undone."
        onClose={onClose}
        actions={<EvalButton variant="secondary">Cancel</EvalButton>}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Withdraw your application?' });
    expect(dialog.textContent).toContain('This cannot be undone.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the checkbox row is a native, unchecked checkbox named by its label', () => {
    const onChange = vi.fn();
    render(
      <EvalCheckboxRow checked={false} onChange={onChange}>
        I have read this notice.
      </EvalCheckboxRow>,
    );
    const box = screen.getByLabelText('I have read this notice.');
    expect(box.getAttribute('type')).toBe('checkbox');
    expect((box as HTMLInputElement).checked).toBe(false);
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('a loading button is disabled and busy, and says the loading label', () => {
    render(
      <EvalButton loading loadingLabel="Saving…">
        Save
      </EvalButton>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

// The focus contract the consent guide and the confirm dialogs rely on (lib/use-dialog-a11y): the sheet starts on the
// text, Tab stays inside it, and closing it returns to "Read the full text"; a confirm dialog starts on Cancel, the safe
// action.
function SheetWithOpener() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Read the full text
      </button>
      {open && (
        <EvalSheet title="Notice" closeLabel={en.common.close} onClose={() => setOpen(false)}>
          <div tabIndex={0} data-autofocus data-testid="consent-full-text">
            Full text
          </div>
        </EvalSheet>
      )}
    </>
  );
}

describe('the dashboard PCA dialogs keep the focus contract', () => {
  it('the sheet focuses the text first, keeps Tab inside, and gives focus back to its opener', async () => {
    render(<SheetWithOpener />);
    const opener = screen.getByRole('button', { name: 'Read the full text' });
    opener.focus();
    fireEvent.click(opener);
    await waitFor(() => expect(screen.getByTestId('consent-full-text')).toHaveFocus());

    const sheet = screen.getByRole('dialog', { name: 'Notice' });
    const closes = within(sheet).getAllByRole('button', { name: en.common.close });
    const first = closes[0]!;
    const last = closes[closes.length - 1]!;
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.click(last);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('the confirm dialog starts on Cancel and keeps Tab inside', async () => {
    render(
      <EvalAlertDialog
        tone="danger"
        icon={null}
        title="Withdraw your application?"
        body="This cannot be undone."
        onClose={vi.fn()}
        actions={
          <>
            <EvalButton variant="secondary">Cancel</EvalButton>
            <EvalButton variant="danger">Withdraw</EvalButton>
          </>
        }
      />,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());
    screen.getByRole('button', { name: 'Withdraw' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(cancel).toHaveFocus();
  });
});

describe('the dashboard shell', () => {
  it('has the eyebrow and the greeting as the h1, and Sign out in the header', () => {
    render(<PortalDashboardShell orgSlug="acme" orgName="Acme" displayName="Ana G" hasCandidate={false} />);
    expect(screen.getByText(pd.eyebrow)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`${pd.welcome}, Ana G`);
    expect(within(screen.getByRole('banner')).getByRole('button', { name: pd.signOut })).toBeTruthy();
    // No logo here: the organization's name links back to its job board.
    expect(within(screen.getByRole('banner')).getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe(
      '/careers/acme',
    );
  });

  it('without a candidate shows the empty state with the way back to the jobs', () => {
    render(<PortalDashboardShell orgSlug="acme" orgName="Acme" displayName="ana@example.com" hasCandidate={false} />);
    expect(screen.getByRole('heading', { level: 2, name: pd.noCandidateTitle })).toBeTruthy();
    expect(screen.getByText(pd.noCandidateDesc)).toBeTruthy();
    expect(screen.getByRole('link', { name: pd.backToJobs }).getAttribute('href')).toBe('/careers/acme');
  });

  it('the eyebrow exists in both languages', () => {
    expect(es.portalDashboard.eyebrow).toBe('Portal del candidato');
    expect(en.portalDashboard.eyebrow).toBe('Candidate portal');
  });
});
