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

  // #304: a caller authorized only via offer:create gets signingUrl null from the server; the detail view
  // maps that to '' and the modal must then show NO link, NO copy action, and the no-link recovery copy.
  it('hides the bearer link and copy action when the caller may not see it (empty signingUrl)', () => {
    const { queryByRole, queryByText, getByText } = render(createElement(SigningLinkModal, {
      signingUrl: '',
      emailDeliveryAccepted: false,
      recipientEmail: 'qa@example.test',
      onClose: () => {},
    }));
    expect(queryByRole('textbox')).toBeNull();
    expect(queryByText(es.common.copy)).toBeNull();
    expect(queryByText(es.offers.signingLinkLabel)).toBeNull();
    expect(getByText(es.offers.offerEmailUnconfirmedNoLinkDetail)).toBeTruthy();
    expect(queryByText(es.offers.offerEmailUnconfirmedDetail)).toBeNull();
  });

  it('shows accepted delivery without a link when the caller may not see it', () => {
    const { queryByRole, getByText } = render(createElement(SigningLinkModal, {
      signingUrl: '',
      emailDeliveryAccepted: true,
      recipientEmail: 'qa@example.test',
      onClose: () => {},
    }));
    expect(queryByRole('textbox')).toBeNull();
    expect(getByText(es.offers.offerEmailAcceptedDetail)).toBeTruthy();
  });
});
