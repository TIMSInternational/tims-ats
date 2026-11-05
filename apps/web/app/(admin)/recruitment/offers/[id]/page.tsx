import { redirect } from 'next/navigation';
import { offerLinkTarget } from '../../../../../lib/offer-deep-link';

// Path-shaped link to one offer, used by the approver email. A signed-out approver is sent to
// /login?redirect=<pathname> and returned here after signing in; this then opens the offers page on that
// offer (`?offer=<id>`). A mangled id shows the offers list. Authorization stays with the page and the API.
export default async function OfferLinkPage({ params }: { params: Promise<{ id: string }> }) {
  redirect(offerLinkTarget((await params).id));
}
