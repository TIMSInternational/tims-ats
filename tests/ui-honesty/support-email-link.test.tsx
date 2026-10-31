import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import en from '../../apps/web/lib/i18n/en.json';

vi.mock('../../apps/web/lib/i18n', () => ({ useI18n: () => ({ t: en, locale: 'EN' }) }));

import { SupportEmailLink } from '../../apps/web/app/(admin)/navbar/support-email-link';
import { resolveSupportEmail } from '../../apps/web/lib/support-email';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('SupportEmailLink', () => {
  it('renders nothing when NEXT_PUBLIC_SUPPORT_EMAIL is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', undefined);
    const { container } = render(<SupportEmailLink />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when NEXT_PUBLIC_SUPPORT_EMAIL is blank', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', '   ');
    const { container } = render(<SupportEmailLink />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when the configured value is not a plain email address', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'help@example.com?bcc=someone@example.com');
    const { container } = render(<SupportEmailLink />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a labelled mailto link to the configured address and nothing else', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPPORT_EMAIL', 'help@example.com');
    const { container } = render(<SupportEmailLink />);
    const links = container.querySelectorAll('a');
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe('mailto:help@example.com');
    expect(links[0]?.getAttribute('aria-label')).toBe(`${en.nav.contactSupport}: help@example.com`);
    // A link, not a chat: no inputs, no phone numbers, no prices.
    expect(container.querySelector('input, textarea')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/\$|\+\d/);
  });
});

describe('resolveSupportEmail', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['not-an-email', null],
    ['a@b', null],
    ['javascript:alert(1)@x.com', null],
    ['"Help" <help@example.com>', null],
    ['  help@example.com  ', 'help@example.com'],
    ['soporte.tims@sub.example.co', 'soporte.tims@sub.example.co'],
  ])('%j -> %j', (raw, expected) => {
    expect(resolveSupportEmail(raw)).toBe(expected);
  });
});
