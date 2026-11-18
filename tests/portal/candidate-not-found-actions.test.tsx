import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const nav = vi.hoisted(() => ({ back: vi.fn(), pathname: '/careers/no-such-org' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: nav.back, push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
}));

import { CandidateNotFoundActions } from '../../apps/web/components/candidate-not-found-actions';
import CareersNotFound from '../../apps/web/app/(portal)/careers/not-found';
import NotFound from '../../apps/web/app/not-found';
import { candidatePortalHref, isCandidate404LinksEnabled } from '../../apps/web/lib/careers-not-found';
import { I18nProvider } from '../../apps/web/lib/i18n';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';

function withI18n(node: React.ReactNode) {
  return render(<I18nProvider>{node}</I18nProvider>);
}

beforeEach(() => {
  nav.back.mockReset();
  nav.pathname = '/careers/no-such-org';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('candidate 404 actions', () => {
  it('below a board: back to its vacancies, plus the candidate portal', () => {
    withI18n(<CandidateNotFoundActions boardHref="/careers/acme" />);
    expect(screen.getByRole('link', { name: es.notFound.backToVacancies })).toHaveAttribute('href', '/careers/acme');
    expect(screen.getByRole('link', { name: es.notFound.candidatePortal })).toHaveAttribute(
      'href',
      '/careers/acme/dashboard',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('with no board and a previous page: one "go back" button that goes back', () => {
    window.history.pushState({}, '', '/careers/a');
    window.history.pushState({}, '', '/careers/b');
    withI18n(<CandidateNotFoundActions boardHref={null} />);
    const back = screen.getByRole('button', { name: es.notFound.goBack });
    fireEvent.click(back);
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('with no board and no previous page: no dead button', () => {
    const spy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(1);
    try {
      withI18n(<CandidateNotFoundActions boardHref={null} />);
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('link')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('copy exists in both languages', () => {
    for (const catalogue of [es, en]) {
      expect(catalogue.notFound.candidatePortal.trim()).not.toBe('');
      expect(catalogue.notFound.goBack.trim()).not.toBe('');
    }
    expect(candidatePortalHref('/careers/acme')).toBe('/careers/acme/dashboard');
  });
});

describe('the 404 pages are unchanged unless NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED is "true"', () => {
  it('only the exact string "true" turns the links on', () => {
    for (const value of [undefined, '', 'TRUE', '1']) expect(isCandidate404LinksEnabled(value)).toBe(false);
    expect(isCandidate404LinksEnabled('true')).toBe(true);
  });

  it('careers 404 (missing board): no action when off, "go back" when on', () => {
    window.history.pushState({}, '', '/careers/x');
    const off = withI18n(<CareersNotFound />);
    expect(screen.queryByRole('button')).toBeNull();
    off.unmount();

    vi.stubEnv('NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED', 'true');
    withI18n(<CareersNotFound />);
    expect(screen.getByRole('button', { name: es.notFound.goBack })).toBeInTheDocument();
  });

  it('root 404 below a board: only "see vacancies" when off, plus the candidate portal when on', () => {
    nav.pathname = '/careers/acme/no/such/page';
    const off = render(<NotFound />);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/careers/acme']);
    off.unmount();

    vi.stubEnv('NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED', 'true');
    render(<NotFound />);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/careers/acme',
      '/careers/acme/dashboard',
    ]);
  });

  it('root 404 outside /careers is untouched by the flag (staff keep "back to dashboard")', () => {
    vi.stubEnv('NEXT_PUBLIC_CANDIDATE_404_LINKS_ENABLED', 'true');
    nav.pathname = '/recruitment/nope';
    render(<NotFound />);
    expect(screen.getByRole('link', { name: es.notFound.backToDashboard })).toHaveAttribute('href', '/dashboard');
  });
});
