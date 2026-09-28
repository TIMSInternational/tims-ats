import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import es from '../../apps/web/lib/i18n/es.json';
import { SigningLinkModal } from '../../apps/web/app/(admin)/recruitment/offers/_components/signing-link-modal';

describe('signing-link delivery status', () => {
  it('shows provider acceptance without claiming inbox delivery', () => {
    const { getByText } = render(createElement(SigningLinkModal, {
      signingUrl: 'https://example.test/offers/sign/test-token',
      emailDeliveryAccepted: true,
      recipientEmail: 'qa@example.test',
      onClose: () => {},
    }));
    expect(getByText(es.offers.offerEmailProviderAccepted)).toBeTruthy();
    expect(getByText(es.offers.offerEmailAcceptedDetail)).toBeTruthy();
    expect(getByText('qa@example.test')).toBeTruthy();
  });

  it('provides a recovery route when sending was unconfirmed', () => {
    const { getByText } = render(createElement(SigningLinkModal, {
      signingUrl: 'https://example.test/offers/sign/test-token',
      emailDeliveryAccepted: false,
      recipientEmail: 'qa@example.test',
      onClose: () => {},
    }));
    expect(getByText(es.offers.offerEmailUnconfirmed)).toBeTruthy();
    expect(getByText(es.offers.offerEmailUnconfirmedDetail)).toBeTruthy();
  });
});
